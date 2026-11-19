# Benchmark OpenCode và Codex qua 9router

Ngày: 2026-11-19. **Chưa chạy benchmark; chưa đủ dữ liệu để quyết định.**

## Điều kiện chặn

- Router `127.0.0.1:20128` đang dùng chung; có tiến trình Codex app-server khác đã cấu hình qua router. Không dừng hoặc thay đổi tiến trình của owner.
- `GET /api/usage` và `/api/usage/stats` trả HTTP 401. Cơ sở dữ liệu local có bảng `usageHistory` và trường `cost`; 100 bản ghi gần nhất khớp model có `cost > 0`. Chưa xác minh nguồn giá, đối soát hoá đơn, attribution từng request hay độ trễ ghi nhận. Số dương không chứng minh chi phí thực.
- Chưa xác minh được giới hạn chi tiêu cứng ở provider hoặc router. Ngắt agent sau khi thấy usage không bảo đảm request đang chạy không vượt trần 10 USD. Không phát sinh request model mới trong lần khảo sát này.

## Kết quả

Chưa có lượt hợp lệ cho HIVE-26 (`be2eb08a^`), HIVE-27 (`4e8351f0^`) hoặc tác vụ khó hơn. Pass/fail, thời gian, input/cache/output và chi phí đều **chưa đo** cho cả hai harness. Chi phí CLI subscription cũng **chưa đo**; không suy từ giá subscription ra chi phí biên cho một lượt.

Các lượt trong [harness-selection](harness-selection.md) không phải đối chứng công bằng: Codex không được chạy lại đồng điều kiện; usage dùng chung chưa được gán chắc chắn. Smoke test tại `5f0df009:docs/research/executor-capability-matrix.md` và E2E tại `1bdbb87c:docs/research/opencode-9router-e2e.md` chứng minh khả năng chạy trong phạm vi mô tả, không chứng minh chi phí hay chất lượng benchmark.

## Trước khi chạy lại

1. Owner cung cấp đường đối soát billing và giới hạn cứng tối đa 10 USD cho credential API DeepSeek dành riêng benchmark; không dùng OAuth subscription. Xác nhận đơn giá input, cache và output, kể cả request lỗi.
2. Cô lập router và credential; xác minh chỉ benchmark dùng ngân sách đó. Thiết lập giới hạn trước khi gửi request, ghi usage theo request và đối chiếu billing. Không lưu credential.
3. Xác định đề bài, tiêu chí nghiệm thu độc lập và tác vụ khó thứ ba trước khi chạy. Tạo sáu bản sao Git riêng, cài dependency trước, dùng cùng model `ds/deepseek-v4-pro`, permission tương đương và chặn đọc chéo log/workspace.
4. Ghi từng lượt pass/fail theo card, thời gian, input/cache/output, chi phí đã đối soát hoặc ghi rõ ước tính; kiểm tra UI và resume khi card yêu cầu. Dừng khi gặp giới hạn; dọn tiến trình thử nghiệm.

**Quyết định:** chưa có căn cứ khuyến nghị opt-in dựa trên chi phí. Tiêu chí tối thiểu: cả hai harness hoàn thành cùng tác vụ theo nghiệm thu độc lập, usage gán được từng lượt, tổng chi phí không vượt 10 USD và chi phí OpenCode đối soát thấp hơn Codex; owner duyệt ngưỡng chất lượng, thời gian và độ ổn định trước rollout. Không đổi mặc định.
