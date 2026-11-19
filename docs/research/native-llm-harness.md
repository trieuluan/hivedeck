# Nghiên cứu: HiveDeck có nên tự gọi LLM API?

Ngày: 2026-11-19

**Kết luận:** Khả thi, nhưng **chưa nên thay CLI bằng harness tự viết**. Chọn **D: giữ executor hiện tại, chuẩn hoá hợp đồng và trải nghiệm**. HiveDeck đã gom điều phối về một nơi; viết lại coding agent sẽ chuyển gánh nặng bảo mật, chất lượng và vận hành sang dự án. SDK không nhất thiết loại bỏ tiến trình CLI. Chỉ thử API trực tiếp khi có nhu cầu cụ thể mà executor hiện tại không đáp ứng và có ngân sách riêng.

## 1. Hiện trạng

- `crates/executors/src/executors/mod.rs` định nghĩa `CodingAgent` và `StandardCodingAgentExecutor`: `CLAUDE_CODE`, `CLAUDE_CODE_HEADED`, `CODEX`, `OPENCODE`, `OPENCODE_HEADED`, `AMP`, `GEMINI`, `CURSOR_AGENT` (alias `CURSOR`), `QWEN_CODE`, `COPILOT`, `DROID`; `QA_MOCK` chỉ có với feature `qa-mode`. Hợp đồng gồm chạy ban đầu, follow-up và chuẩn hoá log; không đồng nghĩa mọi executor hỗ trợ cùng tính năng.
- Claude: `crates/executors/src/executors/claude.rs`, `claude/client.rs`, `claude/protocol.rs`. Headless chạy `claude` với `stream-json` hai chiều; headed chạy tương tác qua tmux. Quyền có thể qua `--permission-prompt-tool=stdio` và hooks; headed xử lý khác. Session ID và `--resume` gắn với Claude. Tùy cấu hình có thể bỏ qua permission: không mặc định suy ra mọi lượt đều được duyệt.
- Codex: `crates/executors/src/executors/codex.rs`, `codex/client.rs`, `codex/jsonrpc.rs`, `codex/normalize_logs.rs`. Chạy `codex app-server`, giao tiếp JSON-RPC qua stdio; thread/turn, sandbox và approval gắn với giao thức Codex. Session resume phụ thuộc thread và dữ liệu của Codex, không chuyển nguyên vẹn sang provider khác.
- OpenCode: `crates/executors/src/executors/opencode.rs`, `opencode/sdk.rs`, `opencode/normalize_logs.rs`. HiveDeck khởi chạy **OpenCode server**, gọi HTTP, nhận sự kiện SSE `/event`, tạo hoặc resume session; adapter chuyển permission và question sang approval service. Đây không phải client LLM native trong tiến trình HiveDeck. Headed có đường chạy tương tác riêng.
- Log: adapter đọc output/sự kiện riêng, chuẩn hoá thành entry và JSON patch qua `crates/executors/src/logs/`; `crates/services/src/services/container.rs` quản lý `MsgStore` và gọi `normalize_logs`. Các client có logic riêng cho delta, trạng thái tool, lỗi và session; không thể thay stream JSON của từng CLI bằng stream token thô mà vẫn giữ UI.
- Approval/câu hỏi: `crates/executors/src/approvals.rs` định nghĩa service chung; `crates/executors/src/executors/claude/client.rs`, `codex/client.rs`, `opencode/sdk.rs` ánh xạ request và response theo từng protocol. Tính năng, policy và đường headed khác nhau; cần kiểm tra từng adapter, không hứa parity.
- MCP: `crates/executors/src/mcp_config.rs` chuyển cấu hình sang schema từng agent; `executors/mod.rs` chọn nơi lưu; Codex có cấu hình MCP riêng, OpenCode dùng `mcp`, Claude dùng schema tương ứng. Runtime CLI/server vẫn là MCP client thực thi tool. HiveDeck còn cung cấp MCP cho agent; xem `docs/ADR/ADR-023-mcp-card-tool-surface.md`.
- Phụ thuộc CLI không chỉ ở lệnh spawn: còn protocol, format log, permission, session store, tool, cấu hình, đăng nhập và version. `crates/executors/src/executor_discovery.rs`, `command.rs`, `profile.rs`, `extensions.rs` cùng `docs/ADR/ADR-038-per-cli-extension-controls.md` cho thấy các điểm tích hợp bổ sung. `docs/ADR/ADR-026-embedded-9router.md` và `docs/ADR/ADR-042-provider-spend.md` mô tả routing/spend hiện có; 9router không thay coding-agent harness.

## 2. Phải tự xây lại gì?

S/M/L là độ lớn tương đối, không phải cam kết lịch: S vài ngày, M khoảng 1–2 tuần, L nhiều tuần trở lên cho một người có kinh nghiệm; chưa tính bảo trì, kiểm thử đa OS/provider và bất định. Các mục chồng lấn; không cộng máy móc.

| Hạng mục | Việc cần chịu trách nhiệm | Cỡ |
| --- | --- | --- |
| Agent loop và tool | Tool calling, nhiều lượt, đọc/ghi file, diff an toàn, tìm kiếm, bash, giới hạn output, huỷ và timeout | L |
| Isolation và permission | Sandbox thực thi theo OS, boundary worktree, mạng, symlink, thao tác phá huỷ, approval trước side effect, fail closed | L |
| Context và session | Transcript bền vững, resume sau crash, token budget, compaction, giữ chỉ dẫn và tool results đúng thứ tự | L |
| Provider adapter | Streaming, schema tool và lỗi khác nhau, model capabilities, version, structured output; không giả định API tương thích hoàn toàn | L |
| MCP client | Discovery, stdio/HTTP, auth, lifecycle, chuyển tool schema, approval, timeout và lỗi | L |
| Logging và tương tác | Map delta/tool/usage vào normalized entries, approval/question, reconnect, hủy; tương thích TUI/Telegram/UI | M–L |
| Độ tin cậy | Retry có backoff/429, timeout, cancellation, tránh chạy lại side effect khi kết quả không chắc chắn | M–L |
| Cache và chi phí | Prompt caching theo từng provider, cache invalidation, usage, giới hạn chi tiêu, báo giá ước lượng | M |
| Ảnh và tệp | Kiểm tra MIME/kích thước, chuyển ảnh, đính kèm, giới hạn model, tránh lộ dữ liệu | M |
| Chất lượng và bảo trì | System prompts, `AGENTS.md`, skills, subagent, hành vi Git, eval hồi quy thực tế, cập nhật API và vá bảo mật | L liên tục |

PoC một provider với vài tool có thể nhỏ hơn đáng kể; **không** chứng minh tương đương Claude/Codex về an toàn, resume hay chất lượng. API/SDK có thể cung cấp một số khả năng, nhưng kiểm thử và chính sách tích hợp vẫn thuộc HiveDeck.

## 3. Chi phí và xác thực

- CLI đăng nhập bằng subscription đủ điều kiện có hạn mức và điều kiện riêng; không mặc định mọi model/lượt đều miễn phí. Codex cũng có thể dùng API key. [OpenAI xác nhận](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex) đăng nhập ChatGPT dùng quota/billing của gói, còn API key dùng giá API; [billing ChatGPT và API tách biệt](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform).
- Gọi API trực tiếp thường tính theo input/output token, cache read/write và có thể phí tool; nhiều lượt tool gửi lại context khiến chi phí tăng. Xem [bảng giá OpenAI](https://platform.openai.com/pricing/) và [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing); giá, model và mức cache thay đổi. Công thức dự toán: tổng token input không cache × giá input + cache read/write × giá tương ứng + output × giá output + phí tool. So sánh bằng workload thực, không lấy số token một lượt nhân số card. Số liệu 9router là ước tính, không phải hoá đơn.
- Ngoại lệ quan trọng: [Anthropic có API credits cho các gói đủ điều kiện](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers); đó là credit API có điều kiện, **không** biến quota subscription thành API không giới hạn. OpenAI cũng có thể có [credit khuyến mại cho gói đủ điều kiện](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions). Kiểm tra điều kiện hiện hành trước khi dự toán.
- **Không trích xuất hoặc tái sử dụng OAuth token của Claude/ChatGPT subscription để gọi API trong harness riêng.** Đăng nhập hợp lệ qua CLI/SDK hoặc luồng tích hợp chính thức khác với dùng token đó làm API key. Tài liệu billing không tự chứng minh một token cụ thể bị cấm theo mọi hợp đồng; quyền dùng phụ thuộc sản phẩm, luồng được hỗ trợ và điều khoản hiện hành. Chưa xác minh được một điều khoản chung bao phủ mọi tích hợp OpenAI; chỉ triển khai khi nhà cung cấp xác nhận rõ bằng tài liệu hoặc văn bản. API key hay OAuth **của nền tảng API được cấp cho mục đích đó** là trường hợp khác, không đồng nhất với token subscription. Không đặt credential trong log, Git hoặc prompt.

## 4. Phương án

| Phương án | Ưu | Nhược |
| --- | --- | --- |
| A. Harness tự viết, API trực tiếp | Toàn quyền UX, tool, routing và quan sát; không cần CLI vendor | Chi phí token riêng; toàn bộ mục 2 là trách nhiệm HiveDeck; rủi ro bảo mật và chất lượng; khóa vào thay đổi API |
| B. Agent SDK | Giảm công xây loop/tool; tận dụng runtime chính thức | Không nhất thiết in-process hoặc không CLI: [Codex TypeScript SDK bọc CLI](https://github.com/openai/codex/blob/main/sdk/typescript/README.md); [Python SDK dùng app-server subprocess](https://github.com/openai/codex/blob/main/sdk/python/src/openai_codex/client.py). Tích hợp Rust có thể cần bridge; kiểm tra auth, phí, lifecycle và tính năng từng SDK, không mặc định dùng subscription |
| C. OpenCode đa provider làm mặc định | Một giao diện agent cho nhiều provider; HiveDeck đã có adapter HTTP/SSE | Vẫn phụ thuộc server/process và release OpenCode; mất hoặc khác tính năng đặc thù Claude/Codex, auth và quota theo provider; cần benchmark trước khi đổi mặc định |
| D. Giữ executor, chuẩn hoá lớp chung | Giữ subscription và khả năng riêng theo luồng được hỗ trợ; ít rủi ro; giảm phân tán trong UX | Vẫn cài, cập nhật và xử lý khác biệt CLI; không có một runtime native thống nhất |

SDK là giao diện lập trình, không đồng nghĩa runtime nhúng. Không so sánh chi phí B như một loại billing cố định: phụ thuộc SDK, credential và provider thực tế.

## 5. Khuyến nghị và các card

Chọn **D**. Mục tiêu là một control surface nhất quán, không nhất thiết một tiến trình. Không đổi mặc định hoặc di chuyển session đang chạy. Các card độc lập, sau mỗi card đánh giá lại:

1. **Ma trận capability:** ghi nhận theo executor/version các khả năng stream, resume, approval, question, ảnh, MCP và auth; đánh dấu unsupported thay vì giả lập.
2. **Hợp đồng và kiểm thử adapter:** fixture cho log delta, lỗi, huỷ, approval và resume; đảm bảo không chạy lại tool khi reconnect. Không thay protocol vendor.
3. **UX thống nhất:** hiển thị capability, nguồn auth, trạng thái process và chi phí/quota khi có dữ liệu; phân biệt ước tính với billing thật, không hiển thị secret.
4. **Đánh giá OpenCode opt-in:** benchmark cùng bộ tác vụ, cùng mức permission, đo chất lượng, resume, độ trễ và chi phí; giữ CLI hiện tại làm đối chứng. Chỉ đề xuất mặc định mới nếu đạt tiêu chí owner chấp nhận.
5. **Chỉ nếu còn khoảng trống:** timebox PoC API một provider, API key riêng, sandbox bắt buộc và ngân sách cứng; đo so với CLI. Dừng nếu không tạo lợi ích rõ ràng; không đưa PoC thành mặc định hay tuyên bố parity.

Nghiên cứu dựa trên mã nguồn hiện tại và tài liệu công khai tại ngày ghi trên; chưa chạy benchmark, kiểm toán bảo mật hoặc xác nhận điều khoản riêng với nhà cung cấp.
