# Benchmark OpenCode và Codex qua 9router

Ngày 2026-11-19. **Chưa nên chọn OpenCode+9router làm lựa chọn chính:** sáu lượt tốn khoảng 2,395 USD, nhưng không lượt nào được xác nhận đạt toàn bộ nghiệm thu. Hai lượt HIVE-27 thiếu fallback khi executor lỗi sau khi khởi chạy. Chưa đo chi phí biên của subscription để so sánh với chi phí API.

## Thiết kế

Chạy tuần tự, mỗi lượt giới hạn 20 phút, model `ds/deepseek-v4-pro` qua router `127.0.0.1:20128`, dùng key DeepSeek đã cấu hình trong router, không dùng OAuth subscription. OpenCode 1.19.6 dùng `--pure --format json`, `permission: allow`; Codex 0.152.1 dùng `exec --json`, `-a never -s workspace-write` vì bản này không có `--full-auto`. Cả hai tự duyệt; sandbox Codex hạn chế ghi ngoài workspace, OpenCode không có bảo vệ tương đương. Đây không phải cô lập bảo mật OS.

Mỗi lượt dùng clone Git và HOME/config riêng dưới `/tmp/hive34-bench`, không trỏ tới log lượt khác. Dependency được cài thành công bằng `pnpm install --offline --frozen-lockfile` trước bấm giờ. Prompt HIVE-26 và HIVE-27 lấy từ `/tmp/hivedeck-harness-bench/card26-prompt.txt` và `card27-prompt.txt`, không lấy kết quả cũ; các bản gốc tương ứng `be2eb08a^` và `4e8351f0^`, như [harness-selection](harness-selection.md). Tác vụ thứ ba, bản gốc `99f974bc`: thêm tìm kiếm không phân biệt hoa/thường trong preview Markdown, đếm và chuyển kết quả vòng tròn, cuộn tới kết quả, reset khi đổi/đóng, giữ Markdown/link và accessibility, có test, không thêm dependency hay đổi backend. Đây là tác vụ thiết kế riêng, không phải card lịch sử.

Đồng hồ là thời gian thực từ lúc khởi chạy tới khi tiến trình kết thúc, gồm model, công cụ và test của agent; không gồm cài dependency. Model/API khác giao thức (OpenCode Chat Completions, Codex Responses), triển khai tool và sandbox khác nhau; thời gian có thể chịu tải máy và router dùng chung. Một mẫu mỗi ô không đo được độ ổn định hay ý nghĩa thống kê.

## Kết quả sáu lượt

Input là cache miss; cache là cache hit; output gồm reasoning. Số token cộng qua các request, không phải context duy nhất. Chi phí tính theo giá cao điểm để bảo thủ, không phải hoá đơn.

| Tác vụ | Harness | Nghiệm thu | Giây | Input | Cache | Output | USD ước tính |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| HIVE-26 | OpenCode | Chưa xác nhận | 124 | 56.537 | 352.256 | 5.447 | 0,1117 |
| HIVE-26 | Codex | Chưa xác nhận | 309 | 33.747 | 910.976 | 12.672 | 0,1348 |
| HIVE-27 | OpenCode | Fail | 988 | 204.906 | 4.610.176 | 32.351 | 0,6014 |
| HIVE-27 | Codex | Fail | 1.166 | 101.790 | 12.557.696 | 50.349 | 0,8863 |
| Tìm trong Markdown | OpenCode | Chưa xác nhận | 522 | 130.120 | 1.860.096 | 25.837 | 0,3559 |
| Tìm trong Markdown | Codex | Fail | 800 | 39.168 | 2.472.704 | 36.475 | 0,3049 |
| **Tổng sáu lượt** | **OpenCode / Codex** | | | | | | **1,0690 / 1,3260** |

Nguồn số: các event `step_finish.part.tokens` trong `/tmp/hive34-bench/{26-open2,27-open,hard-open}.jsonl`; `turn.completed.usage` trong `/tmp/hive34-bench/{26-codex2,27-codex,hard-codex}.jsonl`. OpenCode tách `reasoning` khỏi `output`, cộng cả hai; Codex `output_tokens` đã bao gồm reasoning, không cộng lại. Thời điểm bắt đầu/kết thúc UTC do wrapper ghi khi chạy: lần lượt 07:44:11–07:46:15, 07:46:52–07:52:07, 07:53:12–08:09:40, 08:10:02–08:29:28, 08:30:01–08:38:43, 08:39:05–08:52:25; làm tròn giây từ thời điểm có phần lẻ. Log tạm không phải artefact lưu vĩnh viễn.

Nghiệm thu độc lập: cả sáu bản sao chạy lại Vitest web-core thành công, 215/215 cho mỗi card cũ, 224/224 cho tác vụ khó OpenCode, 223/223 cho Codex (`/tmp/hive34-bench/verify-*.log`). Agent báo thêm typecheck/lint; chưa chạy độc lập toàn bộ. Chưa chạy browser, kiểm tra focus/Esc, hoặc chạy captain/resume thực; vì vậy HIVE-26 và tác vụ khó OpenCode không được coi là pass đầy đủ. HIVE-27: cả hai nhánh fallback chỉ xử lý lỗi trả về ngay từ `run_follow_up`; hàm này trả sau `start_execution`, không đợi executor kết thúc. Lỗi resume xảy ra sau khi spawn không kích hoạt fallback/notice theo yêu cầu. Tác vụ khó Codex tìm từng text node, không tìm được cụm xuyên phần tử Markdown, ví dụ `hello **world**` với từ khoá `hello world`; chính agent xác nhận hạn chế. Không coi exit 0 hoặc test đơn vị là pass toàn bộ.

## Giá và cộng dồn

Nguồn: [bảng giá DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/?model_version=DeepSeek-V4-Pro-0813), kiểm tra 2026-11-19. USD/triệu token cho `deepseek-v4-pro`: cao điểm cache miss **1,32**, cache hit **0,044**, output **3,96**; ngoài cao điểm tương ứng **0,66**, **0,022**, **1,98**. Cao điểm: 01:00–04:00 và 06:00–10:00 UTC thứ Hai–thứ Sáu, trừ ngày lễ Trung Quốc. Các lượt trên chạy trong khoảng cao điểm theo đồng hồ hệ thống. Chi phí = miss × giá miss + hit × giá hit + output × giá output. Search/Fetch tính riêng nếu dùng; chưa xác minh có phát sinh, nên tổng chỉ là ước tính token model, không phải hoá đơn.

Trước sáu lượt có hai lần thử bị loại: OpenCode kế thừa `PWD` sai và đọc checkout hiện tại, tốn ước tính **0,0891 USD** theo `26-open.jsonl`; Codex bị dừng chủ động sau 34 giây khi phát hiện lỗi môi trường, không có `turn.completed.usage`. Để giữ ngân sách, lấy chặn trên thô **0,0759 USD** từ bốn record model DeepSeek trong `usageHistory` của router trong khoảng 07:42:59–07:43:40 UTC: 53.502 prompt và 1.329 completion, tính toàn bộ prompt theo giá cache miss. Router dùng chung nên số này có thể gồm request khác, bỏ sót request ghi muộn, không phải attribution hay billing; chi phí lượt bị dừng vẫn chưa biết chắc.

Cộng dồn gồm hai lần loại: sau OpenCode HIVE-26 **0,2767**, Codex HIVE-26 **0,4115**, OpenCode HIVE-27 **1,0130**, Codex HIVE-27 **1,8993**, OpenCode khó **2,2552**, Codex khó **2,5601 USD**. Ước lượng lượt tiếp theo khoảng 1,26 USD dựa trên mức token của lượt HIVE-27 trước đây trong [harness-selection](harness-selection.md) tính theo giá cao điểm; tổng dự kiến luôn dưới trần mềm 5 USD. Dự phòng không phải giới hạn cứng; tổng có thể thiếu chi phí từ request bị dừng hoặc Search/Fetch. Sáu lượt hoàn thành trước timeout.

## Quyết định

Không đổi mặc định. Dữ liệu mẫu cho thấy tổng token-price OpenCode thấp hơn Codex khoảng 19% trên ba tác vụ, nhưng không chứng minh tiết kiệm với subscription và không bù được nghiệm thu chưa đạt. Chỉ cân nhắc opt-in sau khi sửa và chạy lại các kịch bản UI/focus, captain resume và lỗi bất đồng bộ, kiểm tra tìm kiếm trên Markdown thật, xác minh model/usage upstream, và owner chấp thuận ngưỡng chất lượng, thời gian, độ ổn định. So sánh subscription chỉ khi đo được chi phí biên thực tế; không suy từ giá gói.
