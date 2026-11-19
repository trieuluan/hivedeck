# Kiểm thử OpenCode qua 9router trong HiveDeck

Ngày: 2026-11-19. Commit HiveDeck: `23254b8c`. **Kết luận: các luồng được thử hoạt động; chưa đủ bằng chứng để đổi executor mặc định.** Không đo chi phí. Kết quả áp dụng cho môi trường và phiên bản thử, không bảo đảm tương thích mọi model hoặc provider.

## Môi trường

- HiveDeck backend và UI chạy từ worktree riêng, cổng `35872` và `35871`; dữ liệu và HOME cô lập trong `/tmp`. Repository thử là bản clone riêng. Backend thử dùng bản sao cơ sở dữ liệu, không phải cơ sở dữ liệu đang chạy của owner.
- OpenCode `1.19.6` từ npm cache, chạy bằng executor `OPENCODE`; 9router đang chạy ở `127.0.0.1:20128`. Provider `router` dùng `@ai-sdk/openai-compatible`, endpoint `/v1`, model `ds/deepseek-v4-pro`. Cấu hình tạm dùng API key có sẵn, không dùng OAuth subscription; không ghi key vào báo cáo. Loại credential upstream DeepSeek dựa trên khảo sát metadata trong [harness-selection](harness-selection.md), không được kiểm tra lại ở đây.
- MCP `hivedeck` được cấu hình **tường minh** trong cấu hình OpenCode tạm, trỏ HTTP đến backend cô lập `/mcp`. Kiểm thử này không chứng minh HiveDeck tự cấp MCP cho mọi crew.
- Gọi `/api/workspaces/start` với `executor: OPENCODE`, `model_id: router/ds/deepseek-v4-pro`, `permission_policy: SUPERVISED`; các lượt tiếp theo qua `/api/sessions/{id}/follow-up`. UI được kiểm tra bằng `scripts/browser/cdp.mjs` với headless Chrome; không phát hiện lỗi JavaScript trong các lượt kiểm tra.

## Kết quả

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Crew gọi MCP | **Pass**, với cấu hình MCP tường minh | Normalized log: `hivedeck_list_issues`, `status: success`; phản hồi có danh sách issues. Lần đầu không truyền `project_id` trả `project_id is required (not available from workspace context)`; lần tiếp theo truyền project ID thì thành công. |
| Permission approval | **Pass** | Với `SUPERVISED`, yêu cầu chạy `printf HIVEDECK_E2E_OK` tạo approval `bash`; UI hiển thị lệnh và nút `Approve`. Bấm nút, UI hiển thị `HIVEDECK_E2E_OK`; execution `completed`, exit `0`. |
| Question | **Pass** | UI hiển thị `Agent is asking a question`, `Choose a color.`, lựa chọn `Red` và `Blue`. Bấm `Red`; UI hiện `Answered 1 question`; follow-up trả `You chose Red`. |
| Cancel / `stop_execution` | **Pass** | Khi question đang chờ, `POST /api/execution-processes/{id}/stop` trả `success: true`; execution chuyển `killed`; `/api/approvals/pending/{id}` trả `[]`. Chưa kiểm tra dừng shell con đang thực thi hoặc UI stop button. |
| Reconnect | **Pass**, giới hạn UI | Đóng phiên headless Chrome, mở phiên mới vào cùng workspace khi question đang chờ; UI phục hồi question và trả lời được. Chưa thử restart backend, mất mạng kéo dài hoặc reconnect OpenCode server độc lập. |
| Follow-up / resume | **Pass** | `POST /api/sessions/{id}/follow-up` tạo execution mới với session OpenCode; model nhớ câu trả lời `Red` từ lượt trước. |
| Resume sau lỗi | **Pass**, một trường hợp | Follow-up dùng model cố ý không tồn tại kết thúc `failed`, exit `1`, log `OpenCode session.prompt failed: HTTP 500 Internal Server Error`. Follow-up tiếp với model đúng trả `Red`, giữ context trước lỗi. Chưa thử lỗi router hoặc mất điện. |
| Normalized log: delta, tool, lỗi | **Pass**, phạm vi quan sát | WebSocket `/api/execution-processes/{id}/normalized-logs/ws` phát `add` rồi nhiều `replace` cho `thinking`; tool `hivedeck_list_issues` chuyển `created` sang `success`; lỗi model hiện `error_message`. UI hiển thị kết quả tool, `HIVEDECK_E2E_OK` và lỗi HTTP 500. Chưa kiểm tra đầy đủ mọi loại delta hoặc lỗi. |

## Lưu ý triển khai

- `GET /api/approvals/pending/{execution_process_id}` cho question trả `questions: null`, trong khi normalized log và UI vẫn có nội dung câu hỏi và trả lời được. Client chỉ dùng endpoint pending không thể dựa vào đó để hiển thị câu hỏi; cần điều tra riêng trước khi khẳng định parity cho client khác.
- Log backend có cảnh báo `Failed to send signal SIGTERM to process group: Operation not permitted` trong quá trình dọn process. Sau khi dừng backend thử, không quan sát thấy process `opencode serve` hoặc listener trên ba cổng thử; chưa xác định nguyên nhân cảnh báo hay chứng minh không có process con mồ côi khác.
- Kết quả MCP thành công dùng `project_id` tường minh. Không suy ra context project tự được truyền cho workspace không liên kết issue.
- Không thay đổi executor mặc định, adapter hoặc profile của owner. Không đưa credential, nội dung issue hoặc log đầy đủ vào Git.
