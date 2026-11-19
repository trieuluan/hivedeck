# Nghiên cứu: gom về một CLI gọn (Pi, OpenCode…) thay vì nhiều CLI

Ngày: 2026-11-19. Tiếp nối [native-llm-harness](native-llm-harness.md), [harness-selection](harness-selection.md), [executor-capability-matrix](executor-capability-matrix.md).

**Kết luận:** **Không fork.** **Có gom bớt**: giữ 3 executor được hỗ trợ chính thức thay vì 11, và thêm **Pi** làm executor opt-in cho các model API key/9router và cho captain, sau khi có benchmark. Pi gọn nhất trong các CLI đã khảo sát (overhead khoảng 2k token so với 8–21k). Hệ extension của Pi cho HiveDeck chỉnh prompt, tool và approval mà không cần fork. Không thể gom về đúng *một* CLI mà không mất đường dùng subscription Claude.

## 1. Overhead mỗi request: đo trên máy

Phương pháp: một server giả chạy cục bộ (`127.0.0.1`), chỉ ghi lại body request đầu tiên rồi trả HTTP 400. Không gọi model thật, không dùng credential, `HOME` cô lập, repo thử chỉ có `README.md`, prompt `Reply OK`. Token ước tính theo **ký tự/4**. Đây là con số thô cho JSON, đủ để so thứ hạng, không dùng để tính tiền.

| CLI (phiên bản) | Body request đầu | System / instructions | Tool schema | Số tool | ≈ token |
|---|---|---|---|---|---|
| Claude Code 2.1.326 (`-p`) | 86,2 KB | 6,1 KB | 69,5 KB | 22 | **~21k** |
| Claude Code, request phụ cùng lượt | 47,4 KB | 6,1 KB | 30,3 KB | 12 | ~12k |
| Codex 0.167.0-alpha (`exec`) | 55,7 KB | ~28 KB developer messages | 25,3 KB | 11 | **~14k** |
| OpenCode 1.19.6 (`run --pure`) | 30,9 KB | 9,9 KB | 21,1 KB | 10 | **~7,7k** |
| Pi 1.5.2 | không chạy được trên máy (*) | ~2,5 KB theo `system-prompt.ts` | 4 tool mặc định | 4 | **~1,9–2,6k** theo đo bên ngoài |

(*) Lệnh cài Pi vào scratchpad bị chặn, nên chưa đo Pi bằng cùng phương pháp. Số của Pi lấy từ source tag `v1.5.2` và hai phép đo độc lập: [Testdino](https://testdino.com/blog/harness-overhead-benchmark) đo 1.894 token, [Portkey](https://portkey.ai/blog/the-harness-tax/) đo khoảng 2.600. Hai nguồn này cũng đo Codex khoảng 15k và Claude Code khoảng 27k, khớp thứ hạng với bảng trên.

Phần lớn overhead là **tool schema**, không phải system prompt. Với Claude Code, các tool HiveDeck không dùng (Cron*, Worktree, WebSearch, DesignSync…) chiếm khoảng 40 KB.

## 2. Overhead nhỏ hơn có làm rẻ hơn tương ứng không?

Không theo tỷ lệ 1:1. Từ request thứ 2, overhead nằm trong prefix được cache (ADR-040 đo được 98–99%), nên chỉ tốn giá cache-read. Dữ liệu cùng model, khác harness:

| Nguồn | Pass rate | Chi phí trung vị / lần pass | Cache hit |
|---|---|---|---|
| [FrontierHarness, Kimi K3, 30 task](https://www.developersdigest.tech/blog/coding-agent-harness-benchmark-cost-per-pass-frontierharness-2026): Codex | 66,7% | $3,47 | 88% |
| Claude Code | 63,3% | $18,34 | 68% |
| Pi | 60,0% | $2,43 | 79% |
| OpenCode | 50,0% | $3,24 | 78% |

- Pi rẻ hơn Codex khoảng **1,4 lần** mỗi lần pass, nhưng thấp hơn 2 task trên 30. Claude Code đắt bất thường, phần lớn vì cache hit thấp và context ban đầu to.
- Nghiên cứu HarnessTax (Arena/Berkeley, 2026-09) cũng ghi nhận: đổi harness làm chất lượng chỉ lệch vài điểm, nhưng chi phí lệch tới 5 lần. Bảng xếp hạng đảo chiều theo task, model và phiên bản (leaderboard HF xếp Claude Code trên Codex). Đây là số liệu bên ngoài, chưa chạy lại trên các card HiveDeck.
- Với **subscription**, overhead không tính bằng tiền mà ăn vào **hạn mức**: request 21k token tiêu quota nhanh hơn request 2k. Vì vậy cắt tool của Claude Code vẫn đáng làm (mục 5).

## 3. Pi ghép vào HiveDeck thế nào

Nguồn: docs của repo `earendil-works/pi` (MIT, khoảng 123k sao, đẩy commit 2026-11-19, release `v1.5.2` ngày 2026-11-10).

| Nhu cầu của HiveDeck | Pi | Ghi chú |
|---|---|---|
| Điều khiển headless | `pi --mode rpc`: JSONL qua stdin/stdout, lệnh có `id`, stream event, `agent_settled` | Cùng kiểu với Codex app-server. Adapter Rust ước khoảng 3–5k dòng (OpenCode khoảng 5,5k, Codex khoảng 5,9k). |
| Approval / question | **Không có approval sẵn.** Extension `permission-gate.ts` / `protected-paths.ts` gọi `ctx.ui.confirm/select`, RPC chuyển thành `extension_ui_request` ↔ `extension_ui_response` | Ánh xạ được sang approval service. HiveDeck phải tự viết và duy trì extension gate. |
| Sandbox | Không có. Docs khuyên chạy trong container/VM | Giống OpenCode; worktree không phải ranh giới bảo mật. |
| MCP (`hivedeck`) | Có sẵn: stdio và streamable HTTP, `~/.pi/agent/mcp.json`, tool `mcp__<server>__<tool>` | Không hỗ trợ SSE kiểu cũ. `/mcp` của HiveDeck là HTTP, cần thử end-to-end. |
| 9router | `models.json` với `baseUrl` và `api`: `openai-completions`, `openai-responses`, `anthropic-messages` | Cả 3 endpoint 9router đã probe thành công ([capability matrix](executor-capability-matrix.md)). |
| Session / resume | File session dạng cây, `--session`, `--continue`, `--fork`, compaction tự động | Chưa kiểm tra resume sau lỗi. |
| Chỉnh prompt và tool | `SYSTEM.md` / `APPEND_SYSTEM.md`, chọn tool, hook `before_agent_start`, extension TypeScript | **Đây là "nắm quyền" mà không cần fork.** |
| Subscription | OAuth/API key qua `/login`; docs nhắc "Sign in with ChatGPT" | Chưa xác minh OpenAI cho phép dùng gói subscription qua Pi. Không dùng OAuth Claude subscription qua Pi (xem native-llm-harness §3). |

## 4. Fork hay dùng nguyên bản?

**Không fork.** Pi và OpenCode ra bản gần như hằng tuần. Một fork phải tự merge, vá bảo mật và theo kịp API provider, đúng loại gánh nặng mà các research trước đã bác. Mọi thứ cần cho việc tiết kiệm token (system prompt, tập tool, compaction, approval) đều chỉnh được qua cấu hình và extension của Pi. Chỉ cân nhắc fork khi có một khoảng trống cụ thể mà extension không làm được và upstream không nhận bản vá.

## 5. Gom về một CLI duy nhất được không?

Không, nếu muốn giữ subscription. Claude subscription chỉ dùng hợp lệ qua Claude Code. Thực tế khả thi:

| Vai trò | Executor đề xuất | Lý do |
|---|---|---|
| Crew dùng gói Claude | **Claude Code** (giữ) | Đường subscription hợp lệ duy nhất. Cắt tool không dùng qua `--tools`/`--disallowedTools` để giảm khoảng 20k token mỗi request xuống gần mức 12k. |
| Crew dùng gói ChatGPT | **Codex** (giữ) | Tương tự. Xem lại nếu xác minh được Pi + "Sign in with ChatGPT" là hợp lệ. |
| Crew dùng API key / 9router (DeepSeek…) | **Pi** (mới, opt-in), hoặc OpenCode trong lúc chờ | Overhead thấp nhất, chi phí mỗi lần pass thấp nhất trong dữ liệu bên ngoài. |
| Captain | **Pi** với tool tối thiểu + MCP `hivedeck` | Captain không cần shell hay edit. Pi cho tắt hết tool tích hợp, chỉ giữ MCP, prompt rất nhỏ. |
| Amp, Gemini, Cursor, Qwen, Copilot, Droid | **Ẩn khỏi UI** (giữ code) | Không CLI nào được cài trên máy; đây là phần phân tán không đem lại gì. |

Kết quả là từ 11 executor còn 3 được hỗ trợ chính thức (Claude Code, Codex, Pi), cộng OpenCode giữ làm phương án dự phòng cho đến khi Pi qua benchmark.

## 6. Card tiếp theo

1. **Cắt tool Claude Code (S):** truyền danh sách tool tối thiểu cho crew/captain headless. Đo lại kích thước request bằng server giả ở mục 1, rồi kiểm tra cache qua 9router. Lợi ích nhanh nhất, không đổi executor.
2. **Ẩn executor không dùng (S):** ẩn khỏi UI, không xoá code. Ghi ADR.
3. **Adapter Pi opt-in (M–L):** RPC client Rust, normalize log, extension permission-gate ánh xạ sang approval, `models.json` trỏ 9router, MCP `hivedeck`, resume. E2E như [opencode-9router-e2e](opencode-9router-e2e.md). Pin phiên bản.
4. **Benchmark công bằng (M):** Pi, OpenCode và Codex cùng model `ds/deepseek-v4-pro`, cùng card và permission. Điều kiện chặn giữ nguyên như [benchmark-opencode-codex](benchmark-opencode-codex.md): credential riêng và trần chi phí 10 USD. Chỉ đổi mặc định cho vai trò API key khi Pi đạt ngưỡng owner duyệt.
5. **Captain trên Pi (M):** sau card 3. So token mỗi lần thức dậy (wakeup) với captain headless Claude hiện tại.

## Giới hạn

- Số đo mục 1 là một lần chạy, một prompt tầm thường, ước lượng ký tự/4. Pi chưa được đo trên máy.
- Mục 2 dùng số liệu bên ngoài với model, task và phiên bản khác. Chưa có dữ liệu chất lượng trên card HiveDeck.
- Chưa kiểm chứng điều khoản subscription của OpenAI với Pi.
