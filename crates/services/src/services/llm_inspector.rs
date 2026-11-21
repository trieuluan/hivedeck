use std::sync::Arc;

use dashmap::DashMap;
use executors::logs::{ContextBreakdown, ContextCategoryMetric};
use serde_json::Value;
use uuid::Uuid;

/// Upstream target registered for a single agent execution & provider slot.
#[derive(Debug, Clone)]
pub struct LlmProxyRoute {
    pub session_id: Uuid,
    pub upstream_base_url: String,
    pub upstream_label: String,
}

/// Usage metrics extracted from an upstream LLM response (JSON or SSE).
#[derive(Debug, Default, Clone)]
pub struct ResponseUsageSnapshot {
    pub model: Option<String>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
    pub has_usage: bool,
}

/// Stateful incremental extractor for SSE / JSON responses across Anthropic,
/// OpenAI (Chat Completions & Responses), and Gemini formats.
#[derive(Debug, Default)]
pub struct SseUsageExtractor {
    line_buf: String,
    pub snapshot: ResponseUsageSnapshot,
}

impl SseUsageExtractor {
    pub fn push_bytes(&mut self, chunk: &[u8]) {
        let text = String::from_utf8_lossy(chunk);
        self.line_buf.push_str(&text);
        while let Some(pos) = self.line_buf.find('\n') {
            let line = self.line_buf[..pos].trim().to_string();
            self.line_buf.drain(..=pos);
            self.process_line(&line);
        }
    }

    pub fn finish(&mut self) {
        let rest = self.line_buf.trim().to_string();
        self.line_buf.clear();
        if !rest.is_empty() {
            self.process_line(&rest);
        }
    }

    fn process_line(&mut self, line: &str) {
        if line.is_empty() || line.starts_with(':') || line.starts_with("event:") {
            return;
        }
        let json_str = line.strip_prefix("data:").map(str::trim).unwrap_or(line);
        if json_str == "[DONE]" || !json_str.starts_with('{') {
            return;
        }
        let Ok(val) = serde_json::from_str::<Value>(json_str) else {
            return;
        };
        self.extract_from_json(&val);
    }

    fn extract_from_json(&mut self, val: &Value) {
        // Model name (top-level, message.model, response.model, or modelVersion)
        if self.snapshot.model.is_none() {
            let model = val
                .get("model")
                .or_else(|| val.pointer("/message/model"))
                .or_else(|| val.pointer("/response/model"))
                .or_else(|| val.get("modelVersion"))
                .and_then(|v| v.as_str())
                .map(str::to_string);
            if model.is_some() {
                self.snapshot.model = model;
            }
        }

        // 1. Anthropic `message_start` (`message.usage`) or non-streaming `usage`
        if let Some(usage) = val
            .pointer("/message/usage")
            .or_else(|| val.get("usage"))
            .filter(|u| u.get("input_tokens").is_some() || u.get("prompt_tokens").is_some())
        {
            if let Some(n) = usage
                .get("input_tokens")
                .or_else(|| usage.get("prompt_tokens"))
                .and_then(|v| v.as_u64())
            {
                self.snapshot.input_tokens = n as u32;
                self.snapshot.has_usage = true;
            }
            if let Some(n) = usage
                .get("output_tokens")
                .or_else(|| usage.get("completion_tokens"))
                .and_then(|v| v.as_u64())
            {
                self.snapshot.output_tokens = n as u32;
                self.snapshot.has_usage = true;
            }
            if let Some(n) = usage
                .get("cache_read_input_tokens")
                .or_else(|| usage.pointer("/prompt_tokens_details/cached_tokens"))
                .or_else(|| usage.pointer("/input_tokens_details/cached_tokens"))
                .and_then(|v| v.as_u64())
            {
                self.snapshot.cache_read_tokens = n as u32;
                self.snapshot.has_usage = true;
            }
            if let Some(n) = usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
            {
                self.snapshot.cache_creation_tokens = n as u32;
                self.snapshot.has_usage = true;
            }
        }

        // 2. Anthropic `message_delta` (only `usage.output_tokens`)
        if val.get("type").and_then(|v| v.as_str()) == Some("message_delta")
            && let Some(out) = val.pointer("/usage/output_tokens").and_then(|v| v.as_u64())
        {
            self.snapshot.output_tokens = out as u32;
            self.snapshot.has_usage = true;
        }

        // 3. OpenAI Responses API (`response.completed` -> `response.usage`)
        if let Some(usage) = val.pointer("/response/usage") {
            if let Some(n) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                self.snapshot.input_tokens = n as u32;
                self.snapshot.has_usage = true;
            }
            if let Some(n) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                self.snapshot.output_tokens = n as u32;
                self.snapshot.has_usage = true;
            }
            if let Some(n) = usage
                .pointer("/input_tokens_details/cached_tokens")
                .and_then(|v| v.as_u64())
            {
                self.snapshot.cache_read_tokens = n as u32;
                self.snapshot.has_usage = true;
            }
        }

        // 4. Google Gemini (`usageMetadata`)
        if let Some(meta) = val.get("usageMetadata") {
            if let Some(n) = meta.get("promptTokenCount").and_then(|v| v.as_u64()) {
                self.snapshot.input_tokens = n as u32;
                self.snapshot.has_usage = true;
            }
            if let Some(n) = meta.get("candidatesTokenCount").and_then(|v| v.as_u64()) {
                self.snapshot.output_tokens = n as u32;
                self.snapshot.has_usage = true;
            }
            if let Some(n) = meta.get("cachedContentTokenCount").and_then(|v| v.as_u64()) {
                self.snapshot.cache_read_tokens = n as u32;
                self.snapshot.has_usage = true;
            }
        }
    }
}

/// Shared registry for live LLM proxy routing and per-session context breakdown telemetry.
#[derive(Debug, Default, Clone)]
pub struct LlmInspector {
    /// Key: (execution_id, provider_slot) where provider_slot is "anthropic" | "openai" | "gemini"
    routes: Arc<DashMap<(Uuid, String), LlmProxyRoute>>,
    /// Key: session_id
    telemetry: Arc<DashMap<Uuid, ContextBreakdown>>,
    /// Key: session_id -> resolved context window from 9router combo/model lookup
    context_windows: Arc<DashMap<Uuid, u32>>,
}

impl LlmInspector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_route(
        &self,
        execution_id: Uuid,
        provider_slot: impl Into<String>,
        session_id: Uuid,
        upstream_base_url: impl Into<String>,
        upstream_label: impl Into<String>,
    ) {
        self.routes.insert(
            (execution_id, provider_slot.into()),
            LlmProxyRoute {
                session_id,
                upstream_base_url: upstream_base_url.into(),
                upstream_label: upstream_label.into(),
            },
        );
    }

    pub fn unregister_execution(&self, execution_id: Uuid) {
        self.routes
            .retain(|(exec_id, _), _| *exec_id != execution_id);
    }

    pub fn get_route(&self, execution_id: Uuid, provider_slot: &str) -> Option<LlmProxyRoute> {
        self.routes
            .get(&(execution_id, provider_slot.to_string()))
            .map(|entry| entry.value().clone())
    }

    pub fn get_session_telemetry(&self, session_id: Uuid) -> Option<ContextBreakdown> {
        self.telemetry
            .get(&session_id)
            .map(|entry| entry.value().clone())
    }

    /// Seed the in-memory telemetry cache from persisted storage if not already loaded.
    pub fn seed_session_telemetry(&self, session_id: Uuid, breakdown: ContextBreakdown) {
        self.telemetry.entry(session_id).or_insert(breakdown);
    }

    pub fn set_session_context_window(&self, session_id: Uuid, window: u32) {
        self.context_windows.insert(session_id, window);
    }

    /// Record the resolved upstream model and/or context window from response
    /// headers (e.g. `x-9router-model`, `x-9router-context-window`) so combo
    /// fallbacks update telemetry immediately.
    pub fn record_upstream_model_headers(
        &self,
        session_id: Uuid,
        model: Option<String>,
        context_window: Option<u32>,
    ) {
        if let Some(window) = context_window.filter(|&w| w > 0) {
            self.context_windows.insert(session_id, window);
        }
        let resolved_window = context_window
            .filter(|&w| w > 0)
            .or_else(|| model.as_deref().map(infer_context_window));
        self.telemetry.entry(session_id).and_modify(|existing| {
            if let Some(ref m) = model {
                existing.model = Some(m.clone());
            }
            if let Some(w) = resolved_window {
                existing.model_context_window = Some(w);
            }
        });
    }

    fn resolve_context_window(&self, session_id: Uuid, model: Option<&str>) -> Option<u32> {
        if let Some(m) = model
            && !is_combo_alias(m)
        {
            return Some(infer_context_window(m));
        }
        self.context_windows
            .get(&session_id)
            .map(|entry| *entry.value())
            .or_else(|| model.map(infer_context_window))
    }

    /// Analyze an outgoing LLM request JSON body and update the session's context breakdown.
    pub fn inspect_request_payload(
        &self,
        session_id: Uuid,
        path: &str,
        body: &[u8],
        upstream_label: &str,
    ) {
        let Ok(json) = serde_json::from_slice::<Value>(body) else {
            return;
        };
        let mut breakdown = analyze_payload(path, &json);
        breakdown.upstream = Some(upstream_label.to_string());
        breakdown.model_context_window =
            self.resolve_context_window(session_id, breakdown.model.as_deref());

        self.telemetry
            .entry(session_id)
            .and_modify(|existing| {
                existing.source = breakdown.source.clone();
                existing.categories = breakdown.categories.clone();
                existing.payload_tokens = breakdown.payload_tokens;
                if breakdown.model.is_some() {
                    existing.model = breakdown.model.clone();
                    existing.model_context_window = breakdown.model_context_window;
                }
                existing.upstream = breakdown.upstream.clone();
            })
            .or_insert(breakdown);
    }

    /// Accumulate response usage metrics (tokens & model) for the session.
    pub fn record_response_usage(&self, session_id: Uuid, usage: ResponseUsageSnapshot) {
        if !usage.has_usage && usage.model.is_none() {
            return;
        }
        self.telemetry
            .entry(session_id)
            .and_modify(|existing| {
                if let Some(ref model) = usage.model {
                    existing.model = Some(model.clone());
                    existing.model_context_window =
                        self.resolve_context_window(session_id, Some(model));
                }
                if usage.has_usage {
                    existing.input_tokens = Some(
                        existing
                            .input_tokens
                            .unwrap_or(0)
                            .saturating_add(usage.input_tokens),
                    );
                    existing.output_tokens = Some(
                        existing
                            .output_tokens
                            .unwrap_or(0)
                            .saturating_add(usage.output_tokens),
                    );
                    existing.cache_read_tokens = Some(
                        existing
                            .cache_read_tokens
                            .unwrap_or(0)
                            .saturating_add(usage.cache_read_tokens),
                    );
                    if usage.cache_creation_tokens > 0 {
                        existing.cache_creation_tokens = Some(
                            existing
                                .cache_creation_tokens
                                .unwrap_or(0)
                                .saturating_add(usage.cache_creation_tokens),
                        );
                    }
                }
            })
            .or_insert_with(|| ContextBreakdown {
                source: "proxy".to_string(),
                categories: Vec::new(),
                payload_tokens: 0,
                model_context_window: usage.model.as_deref().map(infer_context_window),
                model: usage.model,
                upstream: None,
                input_tokens: usage.has_usage.then_some(usage.input_tokens),
                output_tokens: usage.has_usage.then_some(usage.output_tokens),
                cache_read_tokens: usage.has_usage.then_some(usage.cache_read_tokens),
                cache_creation_tokens: (usage.has_usage && usage.cache_creation_tokens > 0)
                    .then_some(usage.cache_creation_tokens),
            });
    }
}

#[derive(Default)]
struct CategoryAccumulator {
    messages: u32,
    mcp_tools: u32,
    mcp_tools_count: u32,
    system_tools: u32,
    system_tools_count: u32,
    deferred_tools_count: u32,
    system_prompt: u32,
    skills: u32,
    skills_count: u32,
    memory_files: u32,
    memory_files_count: u32,
    mcp_instructions: u32,
    custom_agents: u32,
    custom_agents_count: u32,
}

impl CategoryAccumulator {
    fn into_categories(self) -> (Vec<ContextCategoryMetric>, u32) {
        let mut out = Vec::new();
        let mut push = |key: &str, tokens: u32, count: Option<u32>| {
            if tokens > 0 || count.is_some_and(|c| c > 0) {
                out.push(ContextCategoryMetric {
                    key: key.to_string(),
                    tokens,
                    count,
                });
            }
        };

        push("messages", self.messages, None);
        push(
            "mcp_tools",
            self.mcp_tools,
            (self.mcp_tools_count > 0).then_some(self.mcp_tools_count),
        );
        push(
            "system_tools",
            self.system_tools,
            (self.system_tools_count > 0).then_some(self.system_tools_count),
        );
        push("system_prompt", self.system_prompt, None);
        push(
            "skills",
            self.skills,
            (self.skills_count > 0).then_some(self.skills_count),
        );
        push(
            "memory_files",
            self.memory_files,
            (self.memory_files_count > 0).then_some(self.memory_files_count),
        );
        push("mcp_instructions", self.mcp_instructions, None);
        push(
            "custom_agents",
            self.custom_agents,
            (self.custom_agents_count > 0).then_some(self.custom_agents_count),
        );
        if self.deferred_tools_count > 0 {
            push("deferred_tools", 0, Some(self.deferred_tools_count));
        }

        let total = out.iter().map(|c| c.tokens).sum();
        (out, total)
    }

    fn classify_system_text(&mut self, text: &str) {
        if text.trim().is_empty() {
            return;
        }
        // Scan well-known embedded blocks first (<available_skills>, <claudeMd>, etc.)
        let mut remaining_tokens = estimate_text_tokens(text);

        if let Some((skills_toks, skills_cnt)) = extract_skills_block(text) {
            self.skills = self.skills.saturating_add(skills_toks);
            self.skills_count = self.skills_count.saturating_add(skills_cnt);
            remaining_tokens = remaining_tokens.saturating_sub(skills_toks);
        }
        if let Some((mem_toks, mem_cnt)) = extract_memory_block(text) {
            self.memory_files = self.memory_files.saturating_add(mem_toks);
            self.memory_files_count = self.memory_files_count.saturating_add(mem_cnt);
            remaining_tokens = remaining_tokens.saturating_sub(mem_toks);
        }
        if let Some(mcp_inst_toks) = extract_mcp_instructions_block(text) {
            self.mcp_instructions = self.mcp_instructions.saturating_add(mcp_inst_toks);
            remaining_tokens = remaining_tokens.saturating_sub(mcp_inst_toks);
        }
        if let Some((agents_toks, agents_cnt)) = extract_agents_block(text) {
            self.custom_agents = self.custom_agents.saturating_add(agents_toks);
            self.custom_agents_count = self.custom_agents_count.saturating_add(agents_cnt);
            remaining_tokens = remaining_tokens.saturating_sub(agents_toks);
        }

        self.system_prompt = self.system_prompt.saturating_add(remaining_tokens);
    }

    fn classify_message_value(&mut self, msg: &Value) {
        let total = estimate_json_tokens(msg);
        // Claude Code / Codex often inject <claudeMd>, <available_skills>, or <system-reminder>
        // inside early user messages. Extract memory/skills tokens from text fields if present.
        let mut extracted = 0u32;
        if let Some(text) = collect_text_preview(msg) {
            if let Some((mem_toks, mem_cnt)) = extract_memory_block(&text) {
                self.memory_files = self.memory_files.saturating_add(mem_toks);
                self.memory_files_count = self.memory_files_count.saturating_add(mem_cnt);
                extracted = extracted.saturating_add(mem_toks);
            }
            if let Some((skills_toks, skills_cnt)) = extract_skills_block(&text) {
                self.skills = self.skills.saturating_add(skills_toks);
                self.skills_count = self.skills_count.saturating_add(skills_cnt);
                extracted = extracted.saturating_add(skills_toks);
            }
        }
        self.messages = self
            .messages
            .saturating_add(total.saturating_sub(extracted));
    }

    fn classify_tool(&mut self, tool: &Value) {
        let name = tool
            .get("name")
            .or_else(|| tool.pointer("/function/name"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let deferred = tool
            .get("defer_loading")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if deferred {
            self.deferred_tools_count = self.deferred_tools_count.saturating_add(1);
            return;
        }
        let tokens = estimate_json_tokens(tool);
        let is_mcp =
            name.starts_with("mcp__") || tool.get("type").and_then(|v| v.as_str()) == Some("mcp");
        if is_mcp {
            self.mcp_tools = self.mcp_tools.saturating_add(tokens);
            self.mcp_tools_count = self.mcp_tools_count.saturating_add(1);
        } else {
            self.system_tools = self.system_tools.saturating_add(tokens);
            self.system_tools_count = self.system_tools_count.saturating_add(1);
        }
    }
}

/// Analyze an outgoing LLM API JSON payload (Anthropic, OpenAI Chat/Responses, or Gemini).
pub fn analyze_payload(path: &str, json: &Value) -> ContextBreakdown {
    let mut acc = CategoryAccumulator::default();
    let model = json
        .get("model")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    // 1. Tools array (Anthropic, OpenAI Chat, OpenAI Responses, Gemini functionDeclarations)
    if let Some(tools) = json.get("tools").and_then(|v| v.as_array()) {
        for tool in tools {
            if let Some(decls) = tool.get("functionDeclarations").and_then(|v| v.as_array()) {
                for decl in decls {
                    acc.classify_tool(decl);
                }
            } else {
                acc.classify_tool(tool);
            }
        }
    }

    // 2. System / Instructions
    if let Some(system) = json.get("system") {
        classify_system_value(&mut acc, system);
    }
    if let Some(instructions) = json.get("instructions") {
        classify_system_value(&mut acc, instructions);
    }
    if let Some(sys_inst) = json
        .get("systemInstruction")
        .or_else(|| json.get("system_instruction"))
    {
        classify_system_value(&mut acc, sys_inst);
    }

    // 3. Messages / Input / Contents
    if let Some(messages) = json.get("messages").and_then(|v| v.as_array()) {
        for msg in messages {
            let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
            if role == "system" || role == "developer" {
                classify_system_value(&mut acc, msg.get("content").unwrap_or(msg));
            } else {
                acc.classify_message_value(msg);
            }
        }
    }
    if let Some(input) = json.get("input") {
        if let Some(arr) = input.as_array() {
            for item in arr {
                let role = item.get("role").and_then(|v| v.as_str()).unwrap_or("");
                if role == "system" || role == "developer" {
                    classify_system_value(&mut acc, item.get("content").unwrap_or(item));
                } else {
                    acc.classify_message_value(item);
                }
            }
        } else {
            acc.classify_message_value(input);
        }
    }
    if let Some(contents) = json.get("contents").and_then(|v| v.as_array()) {
        for item in contents {
            acc.classify_message_value(item);
        }
    }

    let (categories, payload_tokens) = acc.into_categories();
    let _ = path;

    ContextBreakdown {
        source: "proxy".to_string(),
        categories,
        payload_tokens,
        model,
        upstream: None,
        input_tokens: None,
        output_tokens: None,
        cache_read_tokens: None,
        cache_creation_tokens: None,
        model_context_window: None,
    }
}

pub type NamespaceToolMap = std::collections::HashMap<String, (String, String)>;

/// Flatten OpenAI Responses API `{"type": "namespace", "name": "mcp__...", "tools": [...]}`
/// entries into top-level `"type": "function"` tools (`<namespace>__<tool>`) and drop
/// `defer_loading` / `tool_search` so upstream proxies (like 9router -> DeepSeek/Claude)
/// expose every child MCP tool instead of collapsing the namespace into a single empty tool.
/// Returns the rewritten JSON body plus a map `flat_name -> (namespace, child_name)` for
/// restoring `namespace` + `name` on `function_call` items in the response.
pub fn flatten_responses_tool_namespaces(body: &[u8]) -> Option<(Vec<u8>, NamespaceToolMap)> {
    let mut json: Value = serde_json::from_slice(body).ok()?;
    let tools = json.get("tools").and_then(|v| v.as_array())?;
    let has_namespace = tools.iter().any(|item| {
        item.get("type").and_then(|v| v.as_str()) == Some("namespace")
            && item.get("tools").and_then(|v| v.as_array()).is_some()
    });
    if !has_namespace {
        return None;
    }

    let mut namespace_map = NamespaceToolMap::new();
    let mut flattened = Vec::with_capacity(tools.len());
    for item in tools {
        let item_type = item.get("type").and_then(|v| v.as_str());
        if item_type == Some("namespace")
            && let Some(children) = item.get("tools").and_then(|v| v.as_array())
        {
            let ns_name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let prefix = if ns_name.is_empty() {
                String::new()
            } else {
                format!("{ns_name}__")
            };
            for child in children {
                let mut child_val = child.clone();
                if let Some(obj) = child_val.as_object_mut() {
                    obj.remove("defer_loading");
                    obj.entry("type".to_string())
                        .or_insert_with(|| Value::String("function".to_string()));
                    if !prefix.is_empty()
                        && let Some(orig_name) =
                            obj.get("name").and_then(|v| v.as_str()).map(str::to_string)
                        && !orig_name.is_empty()
                    {
                        let flat_name = if orig_name.starts_with(&prefix) {
                            orig_name.clone()
                        } else {
                            format!("{prefix}{orig_name}")
                        };
                        let child_name = orig_name
                            .strip_prefix(&prefix)
                            .unwrap_or(&orig_name)
                            .to_string();
                        namespace_map.insert(flat_name.clone(), (ns_name.to_string(), child_name));
                        obj.insert("name".to_string(), Value::String(flat_name));
                    }
                }
                flattened.push(child_val);
            }
            continue;
        }
        if item_type == Some("tool_search") {
            continue;
        }
        let mut kept = item.clone();
        if let Some(obj) = kept.as_object_mut() {
            obj.remove("defer_loading");
        }
        flattened.push(kept);
    }

    if let Some(obj) = json.as_object_mut() {
        obj.insert("tools".to_string(), Value::Array(flattened));
        if let Some(input) = obj.get_mut("input").and_then(|v| v.as_array_mut()) {
            for entry in input {
                let Some(entry_obj) = entry.as_object_mut() else {
                    continue;
                };
                if entry_obj.get("type").and_then(|v| v.as_str()) != Some("function_call") {
                    continue;
                }
                let Some(ns) = entry_obj
                    .remove("namespace")
                    .and_then(|v| v.as_str().map(str::to_string))
                    .filter(|s| !s.is_empty())
                else {
                    continue;
                };
                let prefix = format!("{ns}__");
                if let Some(name) = entry_obj.get("name").and_then(|v| v.as_str())
                    && !name.is_empty()
                    && !name.starts_with(&prefix)
                {
                    entry_obj.insert("name".to_string(), Value::String(format!("{prefix}{name}")));
                }
            }
        }
    }
    serde_json::to_vec(&json)
        .ok()
        .map(|bytes| (bytes, namespace_map))
}

fn restore_item_namespace(item: &mut Value, map: &NamespaceToolMap) -> bool {
    let Some(obj) = item.as_object_mut() else {
        return false;
    };
    if obj.get("type").and_then(|v| v.as_str()) != Some("function_call") {
        return false;
    }
    let Some(name) = obj.get("name").and_then(|v| v.as_str()) else {
        return false;
    };
    let Some((ns, child_name)) = map.get(name) else {
        return false;
    };
    obj.insert("namespace".to_string(), Value::String(ns.clone()));
    obj.insert("name".to_string(), Value::String(child_name.clone()));
    true
}

fn restore_responses_payload(json: &mut Value, map: &NamespaceToolMap) -> bool {
    let mut changed = false;
    if let Some(item) = json.get_mut("item") {
        changed |= restore_item_namespace(item, map);
    }
    if let Some(output) = json.get_mut("output").and_then(|v| v.as_array_mut()) {
        for item in output {
            changed |= restore_item_namespace(item, map);
        }
    }
    if let Some(output) = json
        .pointer_mut("/response/output")
        .and_then(|v| v.as_array_mut())
    {
        for item in output {
            changed |= restore_item_namespace(item, map);
        }
    }
    changed
}

/// Line-buffered rewriter that restores `namespace` + child `name` on Responses API
/// `function_call` items (both SSE `data: ...` frames and non-streaming JSON responses).
pub struct NamespaceSseRewriter {
    map: NamespaceToolMap,
    buf: Vec<u8>,
}

impl NamespaceSseRewriter {
    pub fn new(map: NamespaceToolMap) -> Self {
        Self {
            map,
            buf: Vec::new(),
        }
    }

    pub fn push_bytes(&mut self, chunk: &[u8]) -> Vec<u8> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=pos).collect();
            self.rewrite_line(&line, &mut out);
        }
        out
    }

    pub fn finish(mut self) -> Vec<u8> {
        let mut out = Vec::new();
        if !self.buf.is_empty() {
            let tail = std::mem::take(&mut self.buf);
            self.rewrite_line(&tail, &mut out);
        }
        out
    }

    fn rewrite_line(&self, raw_line: &[u8], out: &mut Vec<u8>) {
        let has_nl = raw_line.ends_with(b"\n");
        let without_nl = if has_nl {
            &raw_line[..raw_line.len() - 1]
        } else {
            raw_line
        };
        let has_cr = without_nl.ends_with(b"\r");
        let line_bytes = if has_cr {
            &without_nl[..without_nl.len() - 1]
        } else {
            without_nl
        };

        if let Ok(line_str) = std::str::from_utf8(line_bytes) {
            let (prefix, json_str) = if let Some(rest) = line_str.strip_prefix("data:") {
                let trimmed = rest.trim_start();
                let ws_len = rest.len() - trimmed.len();
                (&line_str[..5 + ws_len], trimmed)
            } else {
                ("", line_str.trim())
            };

            if json_str.starts_with('{')
                && json_str.contains("function_call")
                && let Ok(mut parsed) = serde_json::from_str::<Value>(json_str)
                && restore_responses_payload(&mut parsed, &self.map)
                && let Ok(serialized) = serde_json::to_string(&parsed)
            {
                out.extend_from_slice(prefix.as_bytes());
                out.extend_from_slice(serialized.as_bytes());
                if has_cr {
                    out.push(b'\r');
                }
                if has_nl {
                    out.push(b'\n');
                }
                return;
            }
        }

        out.extend_from_slice(raw_line);
    }
}

fn classify_system_value(acc: &mut CategoryAccumulator, val: &Value) {
    match val {
        Value::String(s) => acc.classify_system_text(s),
        Value::Array(items) => {
            for item in items {
                if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                    acc.classify_system_text(text);
                } else {
                    acc.classify_system_text(&item.to_string());
                }
            }
        }
        Value::Object(map) => {
            if let Some(parts) = map.get("parts").and_then(|v| v.as_array()) {
                for part in parts {
                    if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                        acc.classify_system_text(text);
                    } else {
                        acc.classify_system_text(&part.to_string());
                    }
                }
            } else if let Some(text) = map.get("text").and_then(|v| v.as_str()) {
                acc.classify_system_text(text);
            } else {
                acc.classify_system_text(&val.to_string());
            }
        }
        _ => {}
    }
}

fn collect_text_preview(val: &Value) -> Option<String> {
    let mut out = String::new();
    collect_text_recursive(val, &mut out);
    (!out.is_empty()).then_some(out)
}

fn collect_text_recursive(val: &Value, out: &mut String) {
    match val {
        Value::String(s) => {
            if s.len() < 200_000 {
                out.push_str(s);
                out.push('\n');
            }
        }
        Value::Array(arr) => {
            for item in arr {
                collect_text_recursive(item, out);
            }
        }
        Value::Object(map) => {
            // Skip base64 image payloads
            if map.get("type").and_then(|v| v.as_str()) == Some("base64")
                || map.contains_key("inlineData")
            {
                return;
            }
            for (k, v) in map {
                if k == "data" && v.as_str().is_some_and(|s| s.len() > 2048) {
                    continue;
                }
                collect_text_recursive(v, out);
            }
        }
        _ => {}
    }
}

fn extract_tag_or_section<'a>(text: &'a str, open_tag: &str, close_tag: &str) -> Option<&'a str> {
    let start = text.find(open_tag)?;
    let rest = &text[start..];
    if let Some(end) = rest.find(close_tag) {
        Some(&rest[..end + close_tag.len()])
    } else {
        Some(rest)
    }
}

fn extract_skills_block(text: &str) -> Option<(u32, u32)> {
    if let Some(slice) = extract_tag_or_section(text, "<available_skills>", "</available_skills>")
        .or_else(|| extract_tag_or_section(text, "<skills>", "</skills>"))
    {
        let count = slice
            .matches("<skill>")
            .count()
            .max(
                slice
                    .lines()
                    .filter(|l| l.trim_start().starts_with("- "))
                    .count(),
            )
            .max(1) as u32;
        return Some((estimate_text_tokens(slice), count));
    }
    if text.contains("Available skills:") || text.contains("The following skills are available") {
        let count = text
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                t.starts_with("- ") && t.contains(':')
            })
            .count()
            .max(1) as u32;
        // Attribute lines starting with "- <name>:"
        let skill_chars: usize = text
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                t.starts_with("- ") && t.contains(':')
            })
            .map(|l| l.len() + 1)
            .sum();
        if skill_chars > 0 {
            return Some(((skill_chars as f32 / 3.7).ceil() as u32, count));
        }
    }
    None
}

fn extract_memory_block(text: &str) -> Option<(u32, u32)> {
    if let Some(slice) = extract_tag_or_section(text, "<claudeMd>", "</claudeMd>") {
        let file_count = slice
            .matches("Contents of ")
            .count()
            .max(slice.matches("CLAUDE.md").count())
            .max(1) as u32;
        return Some((estimate_text_tokens(slice), file_count));
    }
    if text.contains("CLAUDE.md") || text.contains("AGENTS.md") || text.contains("<user_rules>") {
        let mut count = 0u32;
        count += text.matches("Contents of ").count() as u32;
        if count == 0 {
            if text.contains("CLAUDE.md") {
                count += 1;
            }
            if text.contains("AGENTS.md") {
                count += 1;
            }
        }
        if let Some(slice) = extract_tag_or_section(text, "<user_rules>", "</user_rules>") {
            return Some((estimate_text_tokens(slice), count.max(1)));
        }
        if text.contains("# Project Instructions") || text.contains("Contents of ") {
            return Some((estimate_text_tokens(text), count.max(1)));
        }
    }
    None
}

fn extract_mcp_instructions_block(text: &str) -> Option<u32> {
    if let Some(slice) = extract_tag_or_section(text, "<mcp_instructions>", "</mcp_instructions>")
        .or_else(|| {
            extract_tag_or_section(
                text,
                "<mcp_server_instructions>",
                "</mcp_server_instructions>",
            )
        })
    {
        return Some(estimate_text_tokens(slice));
    }
    if text.contains("# MCP Server Instructions") || text.contains("MCP server instructions:") {
        return Some(estimate_text_tokens(text));
    }
    None
}

fn extract_agents_block(text: &str) -> Option<(u32, u32)> {
    if let Some(slice) = extract_tag_or_section(text, "<agents>", "</agents>")
        .or_else(|| extract_tag_or_section(text, "<subagents>", "</subagents>"))
    {
        let count = slice
            .matches("<agent")
            .count()
            .max(
                slice
                    .lines()
                    .filter(|l| l.trim_start().starts_with("- "))
                    .count(),
            )
            .max(1) as u32;
        return Some((estimate_text_tokens(slice), count));
    }
    None
}

/// Fast BPE-calibrated token estimator (~3.7 chars/token for English, ~1.5 for multi-byte UTF-8).
pub fn estimate_text_tokens(text: &str) -> u32 {
    if text.is_empty() {
        return 0;
    }
    let mut ascii_bytes = 0usize;
    let mut non_ascii_chars = 0usize;
    for ch in text.chars() {
        if ch.is_ascii() {
            ascii_bytes += 1;
        } else {
            non_ascii_chars += 1;
        }
    }
    let ascii_tokens = (ascii_bytes as f64) / 3.7;
    let non_ascii_tokens = (non_ascii_chars as f64) / 1.5;
    (ascii_tokens + non_ascii_tokens).ceil() as u32
}

/// Estimate tokens for a JSON value, treating base64 image blobs as fixed ~1,600 tokens.
pub fn estimate_json_tokens(val: &Value) -> u32 {
    match val {
        Value::Null => 1,
        Value::Bool(_) => 1,
        Value::Number(n) => estimate_text_tokens(&n.to_string()),
        Value::String(s) => {
            if s.starts_with("data:image/") && s.len() > 1024 {
                1600
            } else {
                estimate_text_tokens(s)
            }
        }
        Value::Array(arr) => {
            let inner: u32 = arr.iter().map(estimate_json_tokens).sum();
            inner.saturating_add(arr.len() as u32)
        }
        Value::Object(map) => {
            // Anthropic / Gemini base64 image block
            if map.get("type").and_then(|v| v.as_str()) == Some("base64")
                && map
                    .get("data")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| s.len() > 1024)
            {
                return 1600;
            }
            if map.contains_key("inlineData") {
                return 1600;
            }
            let mut sum = 2u32;
            for (k, v) in map {
                sum = sum
                    .saturating_add(estimate_text_tokens(k))
                    .saturating_add(estimate_json_tokens(v))
                    .saturating_add(2);
            }
            sum
        }
    }
}

/// Infer context window size from a model identifier when the CLI doesn't emit one.
fn is_combo_alias(model: &str) -> bool {
    let base = model
        .trim()
        .split_once("-r")
        .and_then(|(b, n)| n.parse::<usize>().ok().map(|_| b))
        .unwrap_or_else(|| model.trim());
    matches!(base, "fast" | "coder" | "planner" | "reviewer")
}

pub fn infer_context_window(model: &str) -> u32 {
    let m = model.to_ascii_lowercase();
    if m.contains("[1m]") || m.contains("-1m") {
        return 1_000_000;
    }
    if m.contains("gemini-2") || m.contains("gemini-3") || m.contains("gemini-1.5") {
        return 1_000_000;
    }
    if m.contains("gpt-4.1") {
        return 1_000_000;
    }
    if m.contains("claude-") || m.contains("sonnet") || m.contains("opus") || m.contains("haiku") {
        return 200_000;
    }
    if m.contains("gpt-5") || m.contains("codex") {
        return 272_000;
    }
    if m.contains("o3") || m.contains("o4") {
        return 200_000;
    }
    if m.contains("gpt-4o") {
        return 128_000;
    }
    if m.contains("qwen") || m.contains("deepseek") {
        return 131_072;
    }
    200_000
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn analyzes_anthropic_payload_categories() {
        let payload = json!({
            "model": "claude-sonnet-4-5",
            "system": [
                { "type": "text", "text": "You are Claude Code, an interactive CLI agent." },
                { "type": "text", "text": "<available_skills><skill>a</skill><skill>b</skill></available_skills>" },
                { "type": "text", "text": "<claudeMd>Contents of /repo/CLAUDE.md\nAlways run tests.</claudeMd>" }
            ],
            "tools": [
                { "name": "Bash", "description": "Run shell commands", "input_schema": { "type": "object" } },
                { "name": "mcp__zalo__send", "description": "Send message", "input_schema": { "type": "object" } },
                { "name": "mcp__zalo__read", "description": "Read", "input_schema": { "type": "object" }, "defer_loading": true }
            ],
            "messages": [
                { "role": "user", "content": "Hello world, please inspect the codebase." },
                { "role": "assistant", "content": "Sure, checking now." }
            ]
        });

        let breakdown = analyze_payload("/v1/messages", &payload);
        assert_eq!(breakdown.model.as_deref(), Some("claude-sonnet-4-5"));
        let get = |k: &str| breakdown.categories.iter().find(|c| c.key == k);
        assert!(get("system_prompt").is_some_and(|c| c.tokens > 0));
        assert_eq!(get("skills").and_then(|c| c.count), Some(2));
        assert_eq!(get("memory_files").and_then(|c| c.count), Some(1));
        assert_eq!(get("system_tools").and_then(|c| c.count), Some(1));
        assert_eq!(get("mcp_tools").and_then(|c| c.count), Some(1));
        assert_eq!(get("deferred_tools").and_then(|c| c.count), Some(1));
        assert!(get("messages").is_some_and(|c| c.tokens > 0));
    }

    #[test]
    fn analyzes_openai_responses_payload() {
        let payload = json!({
            "model": "gpt-5-codex",
            "instructions": "Be concise and accurate.",
            "tools": [
                { "type": "function", "name": "shell", "parameters": {} },
                { "type": "function", "name": "mcp__github__list_prs", "parameters": {} }
            ],
            "input": [
                { "role": "user", "content": "Fix the bug in main.rs" }
            ]
        });

        let breakdown = analyze_payload("/responses", &payload);
        let get = |k: &str| breakdown.categories.iter().find(|c| c.key == k);
        assert_eq!(get("system_tools").and_then(|c| c.count), Some(1));
        assert_eq!(get("mcp_tools").and_then(|c| c.count), Some(1));
        assert!(get("system_prompt").is_some_and(|c| c.tokens > 0));
        assert!(get("messages").is_some_and(|c| c.tokens > 0));
    }

    #[test]
    fn extracts_anthropic_sse_usage() {
        let mut ext = SseUsageExtractor::default();
        ext.push_bytes(
            b"event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-sonnet-4-5\",\"usage\":{\"input_tokens\":1200,\"cache_read_input_tokens\":8500,\"cache_creation_input_tokens\":300,\"output_tokens\":4}}}\n\n",
        );
        ext.push_bytes(
            b"event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":250}}\n\n",
        );
        ext.finish();

        assert!(ext.snapshot.has_usage);
        assert_eq!(ext.snapshot.model.as_deref(), Some("claude-sonnet-4-5"));
        assert_eq!(ext.snapshot.input_tokens, 1200);
        assert_eq!(ext.snapshot.cache_read_tokens, 8500);
        assert_eq!(ext.snapshot.cache_creation_tokens, 300);
        assert_eq!(ext.snapshot.output_tokens, 250);
    }

    #[test]
    fn flattens_responses_tool_namespaces() {
        let payload = serde_json::json!({
            "model": "fast",
            "tools": [
                { "type": "function", "name": "exec_command", "parameters": {} },
                { "type": "tool_search", "execution": "client" },
                {
                    "type": "namespace",
                    "name": "mcp__higgsfield",
                    "description": "Higgsfield tools",
                    "tools": [
                        {
                            "type": "function",
                            "name": "generate_image_batch",
                            "description": "Generate images",
                            "parameters": { "type": "object" },
                            "defer_loading": true
                        },
                        {
                            "type": "function",
                            "name": "mcp__higgsfield__models_list",
                            "parameters": { "type": "object" },
                            "defer_loading": true
                        }
                    ]
                }
            ]
        });
        let raw = serde_json::to_vec(&payload).unwrap();
        let (rewritten, ns_map) = flatten_responses_tool_namespaces(&raw).expect("should flatten");
        let parsed: Value = serde_json::from_slice(&rewritten).unwrap();
        let tools = parsed["tools"].as_array().unwrap();
        let names: Vec<&str> = tools
            .iter()
            .filter_map(|t| t.get("name").and_then(|v| v.as_str()))
            .collect();
        assert_eq!(
            names,
            vec![
                "exec_command",
                "mcp__higgsfield__generate_image_batch",
                "mcp__higgsfield__models_list"
            ]
        );
        assert!(tools.iter().all(|t| t.get("defer_loading").is_none()));
        assert!(
            tools
                .iter()
                .all(|t| t.get("type").and_then(|v| v.as_str()) == Some("function"))
        );
        assert_eq!(
            ns_map.get("mcp__higgsfield__generate_image_batch"),
            Some(&(
                "mcp__higgsfield".to_string(),
                "generate_image_batch".to_string()
            ))
        );

        let mut rewriter = NamespaceSseRewriter::new(ns_map);
        let sse = concat!(
            "event: response.output_item.done\n",
            "data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"function_call\",\"call_id\":\"c1\",\"name\":\"mcp__higgsfield__generate_image_batch\",\"arguments\":\"{}\"}}\n\n"
        );
        let mut out = rewriter.push_bytes(&sse.as_bytes()[..45]);
        out.extend_from_slice(&rewriter.push_bytes(&sse.as_bytes()[45..]));
        out.extend_from_slice(&rewriter.finish());
        let out_str = String::from_utf8(out).unwrap();
        assert!(out_str.contains("\"namespace\":\"mcp__higgsfield\""));
        assert!(out_str.contains("\"name\":\"generate_image_batch\""));

        // Requests without namespace tools pass through untouched.
        let plain = serde_json::to_vec(&serde_json::json!({
            "tools": [{ "type": "function", "name": "shell" }]
        }))
        .unwrap();
        assert!(flatten_responses_tool_namespaces(&plain).is_none());
    }
}
