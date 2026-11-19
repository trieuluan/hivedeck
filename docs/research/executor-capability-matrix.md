# Executor capability matrix and 9router

Snapshot: 19 November 2026. Scope is HiveDeck's **headless adapter**, not everything an upstream CLI might support. The recommendation in `docs/research/native-llm-harness.md` and `docs/research/harness-selection.md` remains: keep the executors; do not fork a harness.

## Capability matrix

`Yes` means implemented in the adapter, not verified end-to-end against every CLI version. `No` means this adapter does not implement the capability; it is not emulated. `Unknown` means the checked code does not establish upstream support. A row's source applies to every cell unless a more specific source is given. Image means a **structured image attachment in the initial/follow-up prompt**, not a file path the agent might read. The common executor interface accepts a text prompt (`crates/executors/src/executors/mod.rs:235`). MCP means a config path/integration, not proof that a particular MCP server works.

| Executor | Stream | Resume | Approval | Question | Image | MCP | Auth: subscription OAuth / API key | Adapter sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CLAUDE_CODE | Yes, stream-json | Yes | Yes, when enabled | Yes, when enabled; disabled in bypass mode | No structured attachment | Yes | Both: subscription or API key; adapter also supports router token | `crates/executors/src/executors/claude.rs:186`, `:200`, `:217`, `:325`, `:491`, `:507`, `:744`, `:1079`, `:1368` |
| CODEX | Yes, app-server events | Yes | Yes | Yes | No structured attachment | Yes | Subscription / API-key login handled by CLI; router provider separately configured | `crates/executors/src/executors/codex.rs:248`, `:262`, `:282`, `:749`, `:775`; `crates/executors/src/executors/codex/client.rs:310`, `:380`, `:791` |
| OPENCODE | Yes, server events | Yes, session ID | Yes | Yes | No structured attachment | Yes | Unknown / unknown: provider login is outside adapter | `crates/executors/src/executors/opencode.rs:168`, `:397`, `:416`, `:431`, `:453`; `crates/executors/src/executors/opencode/normalize_logs.rs:116` |
| AMP | Yes, stream-json | Yes, thread ID | No interactive bridge | No interactive bridge | No structured attachment | Yes | Unknown / unknown: login handled outside adapter | `crates/executors/src/executors/amp.rs:35`, `:47`, `:75`, `:84`, `:127`, `:149`; default no-op approval hook `crates/executors/src/executors/mod.rs:238` |
| GEMINI | Yes, ACP | Session ID; fallback replays text history, not native resume | Yes, ACP permission | No separate question bridge | No: ACP prompt is text | Yes | Unknown / unknown: login handled outside adapter | `crates/executors/src/executors/gemini.rs:60`, `:67`, `:80`, `:110`, `:151`; shared ACP sources below |
| CURSOR_AGENT | Yes, stream-json | Yes | No interactive bridge | No interactive bridge | No structured attachment | Yes | Unknown / unknown: login handled outside adapter | `crates/executors/src/executors/cursor.rs:152`, `:170`, `:224`, `:265`, `:611`; `crates/executors/src/executors/mod.rs:238` |
| QWEN_CODE | Yes, ACP | Session ID; fallback replays text history, not native resume | Yes, ACP permission | No separate question bridge | No: ACP prompt is text | Yes | Unknown / unknown: login handled outside adapter | `crates/executors/src/executors/qwen.rs:54`, `:60`, `:77`, `:113`, `:157`; shared ACP sources below |
| COPILOT | Yes, ACP | Session ID; fallback replays text history, not native resume | Yes, ACP permission | No separate question bridge | No: ACP prompt is text | Yes | Unknown / unknown: login handled outside adapter | `crates/executors/src/executors/copilot.rs:82`, `:89`, `:90`, `:128`, `:160`; shared ACP sources below |
| DROID | Yes, stream-json | Yes, session ID | No interactive bridge | No interactive bridge | No structured attachment | Yes | Unknown / unknown: login handled outside adapter | `crates/executors/src/executors/droid.rs:91`, `:135`, `:144`, `:170`, `:198`; `crates/executors/src/executors/mod.rs:238` |

Shared ACP evidence: `crates/executors/src/executors/acp/client.rs:68` handles permissions; `crates/executors/src/executors/acp/harness.rs:349` and `:357` create a session and reconstruct context on fallback; `:453` sends text. The fallback is not an equivalent native resume. Availability/login discovery is not evidence of a specific OAuth or API-key flow (`crates/executors/src/executors/mod.rs:216`).

## 9router routing

Endpoint base below is `http://127.0.0.1:20128/v1`. Profile overrides support environment variables and extra arguments (`crates/executors/src/command.rs:45`); profiles are loaded and merged in `crates/executors/src/profile.rs:277`. Those generic fields do not prove that a CLI honours a particular variable. ADR-026 describes the sidecar and an originally future injection step (`docs/ADR/ADR-026-embedded-9router.md:34`); current code already implements Claude and Codex routing (`crates/services/src/services/nine_router/routing.rs:56`, `:97`). ADR-042 concerns estimated spend, not routing or authentication (`docs/ADR/ADR-042-provider-spend.md:12`).

| Executor | Base URL, endpoint, current HiveDeck configuration | Work |
| --- | --- | --- |
| CLAUDE_CODE | **Yes, tested**: `ANTHROPIC_BASE_URL`, Anthropic Messages `/messages`; role routing already injects URL, token and aliases (`crates/services/src/services/nine_router/routing.rs:59`). | **S**: enable existing routing and choose a combo. |
| CODEX | **Yes, tested**: custom provider, Responses `/responses`; HiveDeck injects `HIVEDECK_CODEX_ROUTER_BASE_URL` and `wire_api="responses"` (`crates/services/src/services/nine_router/routing.rs:101`; `crates/executors/src/executors/codex.rs:472`, `:505`, `:775`). | **S**: enable existing routing and choose a combo. |
| OPENCODE | **Yes, tested**: custom provider using `@ai-sdk/openai-compatible`, `options.baseURL` and model ID, Chat Completions `/chat/completions`. [Upstream provider configuration](https://github.com/anomalyco/opencode/issues/36748) and [config documentation](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/config.mdx); exact cached CLI test below. The adapter's own `base_url` refers to its local OpenCode server, not the provider (`crates/executors/src/executors/opencode.rs:70`, `:155`). | **S** manual provider config; **M** for automatic role routing and making the executable available on PATH (`crates/executors/src/executors/opencode.rs:92`). |
| AMP | Custom URL and model mapping support Chat Completions, Responses and Anthropic Messages, but **not the local loopback router directly**: [Amp sends requests from its servers](https://ampcode.com/docs/customize/model-routing). CLI absent; no HiveDeck mapping (`crates/executors/src/executors/amp.rs:35`). | **L** for a securely accessible gateway and mapping; do not expose the unauthenticated loopback router directly. |
| GEMINI | **Unsupported for the three tested protocols as a direct provider override**: [official config](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md) documents `GOOGLE_GEMINI_BASE_URL` for the Gemini API, not Chat Completions/Responses/Messages; [upstream request](https://github.com/google-gemini/gemini-cli/issues/23385) asks for OpenAI compatibility. CLI absent. | **M–L** to verify a Gemini-native 9router endpoint or implement a protocol bridge; neither is tested here. |
| CURSOR_AGENT | **Unknown**: CLI absent. [Cursor CLI documentation](https://prod.cursor.com/docs/cli/acp) describes Cursor authentication and an endpoint, but does not establish a custom OpenAI/Anthropic provider or model route. Desktop `cursor` is not `cursor-agent`. No dedicated mapping (`crates/executors/src/executors/cursor.rs:152`). | **M–L** only if upstream adds/documents a compatible CLI provider. |
| QWEN_CODE | **Documented, untested**: `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY`; OpenAI-compatible Chat Completions ([official authentication docs](https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/auth.md)). CLI absent; profile env exists but no dedicated mapping (`crates/executors/src/executors/qwen.rs:54`; `crates/executors/src/command.rs:57`). | **S** manual env/profile; **M** automatic role mapping and ACP smoke test. |
| COPILOT | **Documented, untested**: [BYOK config](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference) supports provider/model entries and [OpenAI Chat Completions or Anthropic](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-cli/customize-copilot/add-llm-models). CLI absent; no dedicated mapping (`crates/executors/src/executors/copilot.rs:82`). | **S** manual provider config; **M** automatic mapping and ACP smoke test. |
| DROID | **Documented, untested**: [`customModels`](https://docs.factory.com/model-independence/byok) accepts `model`, `baseUrl`, and `generic-chat-completion-api`; also supports Responses and Messages. [Headless mode](https://docs.factory.com/droid-exec/overview) selects a custom model by `custom:` alias. CLI absent; no dedicated mapping (`crates/executors/src/executors/droid.rs:91`). | **S** manual custom model; **M** automatic mapping and headless smoke test. |

S/M/L are rough relative engineering estimates, not commitments. An unknown is not a claim that a CLI cannot route; verify its installed version and official custom-provider documentation before implementing. No changes to default executors are proposed.

## Live endpoint probe

On 19 November 2026, local `GET /v1/models` returned HTTP 200. Three independent POSTs used `ds/deepseek-v4-pro`, `stream: true`, a `get_weather` function schema and the instruction to call it for Hanoi. No Claude or Codex OAuth credentials were used. Requests omitted authentication headers; local router/provider configuration selected the upstream credentials. Only status and event types were printed; no credential was read or written by the probe. These real requests can incur API-key provider charges and appear in router usage records.

| POST | Result | Streaming tool-call evidence |
| --- | --- | --- |
| `/v1/chat/completions` | HTTP 200, SSE | `tool_calls` and `function` appeared in streamed chunks. |
| `/v1/responses` | HTTP 200, SSE | `function_call`, `response.function_call_arguments.delta`, `response.function_call_arguments.done`, `response.completed`. |
| `/v1/messages` | HTTP 200, SSE | `tool_use`, `input_json_delta`, `message_stop`. |

Reproduction: send the request above in each endpoint's native tool schema, without logging request headers or response bodies; inspect only HTTP status and presence of the listed SSE event types. An initial probe using forced `tool_choice: required` returned HTTP 400 on all three endpoints; the successful probe omitted `tool_choice`. This result proves automatic tool selection for this model and sample only, not forced-tool compatibility, image handling, complete agent behaviour, or provider stability.

## CLI smoke tests

On 19 November 2026, `command -v` found Claude and Codex; OpenCode 1.19.6 was also found under the npm cache, but not on PATH. `command -v` plus a search of the local bin and npm cache did not find the other six CLIs. `cursor` is the editor launcher, not proof that `cursor-agent` is installed. No installations were attempted.

Each test used a fresh temporary `HOME`, a minimal environment, no inherited OAuth credentials, a single prompt `Reply with exactly ROUTER_OK.`, and the 9router model `ds/deepseek-v4-pro`. The local router selected its already-configured API-key provider; the tests did not inspect or print its credentials. Each process exited 0 and returned `ROUTER_OK`:

| CLI and version | Command/configuration tested | Result |
| --- | --- | --- |
| Claude Code 2.1.326 | `claude -p --model ds/deepseek-v4-pro --tools '' --no-session-persistence` with `ANTHROPIC_BASE_URL=http://127.0.0.1:20128/v1` and a non-secret local placeholder `ANTHROPIC_AUTH_TOKEN` | Pass, Anthropic Messages. |
| Codex 0.152.1 | `codex exec --skip-git-repo-check --ephemeral -s read-only -m ds/deepseek-v4-pro`, with `model_provider="hivedeck_9router"` and `model_providers.hivedeck_9router={name="9router",base_url="http://127.0.0.1:20128/v1",wire_api="responses"}` via `-c`; empty existing `CODEX_HOME` | Pass, Responses. |
| OpenCode 1.19.6 | Cached binary, `run --pure -m router/ds/deepseek-v4-pro`; `OPENCODE_CONFIG_CONTENT` supplied `provider.router.npm=@ai-sdk/openai-compatible`, `provider.router.options.baseURL=http://127.0.0.1:20128/v1`, a local placeholder `apiKey`, model entry `ds/deepseek-v4-pro`, and denied tools | Pass, Chat Completions. The cached binary needs PATH installation or a profile command override for HiveDeck. |

These are CLI prompt tests, not HiveDeck integration tests or proof of tool, resume, approval, image or MCP behaviour through the router. The earlier forced-tool HTTP 400 does not establish whether a CLI session requiring forced tool selection works.

## Decision

Claude Code and Codex have existing HiveDeck route wiring and pass isolated CLI prompt tests. OpenCode also passes with a manually configured provider, but its cached binary is not on PATH and role routing is not wired. Qwen, Copilot and Droid have documented compatible providers but were not installed or tested. Gemini needs a separately verified native endpoint or bridge; Cursor CLI support remains unknown. Amp's server-side requests cannot reach this machine's loopback address. No OAuth subscription traffic was used or assumed; do not expose local 9router publicly to make Amp work.
