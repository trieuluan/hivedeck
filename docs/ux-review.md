# HIVE-10 — Khảo sát UX/UI HiveDeck (làm lại HIVE-7)

Ngày khảo sát: 18/11/2026. Phạm vi: khảo sát và đề xuất; không sửa code giao diện.

## Tiến độ và phương pháp

- App thực sự chạy: frontend `http://localhost:3001`, backend `http://localhost:3002`; cả hai trả HTTP 200.
- Khảo sát bằng Headless Chrome qua `scripts/browser/cdp.mjs`, viewport 1440 × 900 (có đo thêm 1280/1920), profile riêng. Đối chiếu DOM, JPEG và source. Không tạo/sửa dữ liệu thật, không chạy agent, không merge, không đổi trạng thái ticket.
- Project khảo sát: `hivedeck`, route `/projects/f2b4243d-7a64-4ab2-830a-bec3e43bc00b`. Workspace: `Đánh giá UX UI HiveDeck v2`, `/workspaces/af3e9fc6-ef79-457b-a394-ee86a70d4e6b`.
- Bám ADR-032 (project cockpit, captain cạnh board), ADR-034 (Advanced switch). Không đề xuất thêm cloud/team/auth hoặc xoá tính năng chuyên sâu.
- P0: chặn hoàn thành luồng/mất dữ liệu; P1: trở ngại chính; P2: cải thiện hiệu suất/nhất quán. Ước lượng cho một dev, gồm kiểm thử, chưa phải cam kết.
- Không có mục nào đủ bằng chứng để xếp P0 trong phạm vi khảo sát.

## Đề xuất

### UX-01 · P1 · Trả diện tích làm việc cho board

- **Vấn đề:** captain luôn mở và có độ rộng cố định, ép board ở màn hình phổ biến; tiêu đề issue bị ellipsis, khó quét nhiều cột.
- **Bằng chứng/vị trí:** viewport 1280 × 900: sidebar x=0 rộng 256, captain x=256 rộng 420, vùng board x=676 rộng 604; 1440: board rộng 764; 1920: 1244. Class `ship-chat ... w-[420px]` tại `packages/web-core/src/pages/kanban/ProjectCaptainColumn.tsx:167`. Có nút “Ẩn thuyền trưởng”, nên không kết luận thiếu khả năng đóng pane.
- **Đề xuất:** khi đang thao tác board, ưu tiên board; thu captain thành thanh trạng thái theo lựa chọn, nhớ kích thước/ẩn hiện theo project; thêm kéo resize và preset Board / Chat / Cả hai. Giữ chat, badge tiến độ, cảnh báo dễ mở lại; không tự ẩn khi đang gõ.
- **Phạm vi ước lượng:** M, 2–4 ngày: layout cockpit + lưu lựa chọn + kiểm thử responsive.
- **Cách kiểm chứng:** so sánh 1280/1440/1920, captain mở/đóng; đọc tên và di chuyển issue qua cột; resize không che composer, giữ selection/scroll khi đổi preset.

### UX-02 · P1 · Trạng thái agent đang chạy mơ hồ

- **Vấn đề:** badge nói “Đang chạy” nhưng người dùng không biết agent đang tiến triển, bị treo hay chờ; trong phiên khảo sát xuất hiện thắc mắc “đây có thấy HIVE-10 hoạt động đâu”.
- **Bằng chứng/vị trí:** project screen hiển thị “Đang chạy trên Claude Code”, workspace hiển thị “Agent đang làm việc…” và badge `Đang chạy — 1`; không có nhịp hoạt động/elapsed/log tail. Chat log workspace ghi câu hỏi trên và phản hồi backend vẫn running dù chưa có thông điệp mới. Source: `packages/ui/src/components/SessionChatBox.tsx` (badge/thông tin phiên), `packages/web-core/src/features/workspace-chat/ui/SessionChatBoxContainer.tsx`.
- **Đề xuất:** hiển thị thời điểm hoạt động cuối, elapsed, heartbeat/indicator có thể đọc bằng accessibility tree; nếu quá ngưỡng không có sự kiện mới thì đổi trạng thái “chờ/không phản hồi”. Không khởi chạy trùng việc.
- **Phạm vi ước lượng:** S–M, 1–2 ngày: dùng dữ liệu execution/entries hiện có + UI state.
- **Cách kiểm chứng:** mở workspace chạy thật, badge cập nhật sau ≤ N giây; giả lập stalled state hiển thị trạng thái rõ ràng, không đổi nhầm giữa chạy/chờ.

### UX-03 · P1 · Vùng bấm nhỏ và thiếu tên cho icon-only

- **Vấn đề:** nhiều thao tác chỉ là glyph nhỏ, khó bấm chính xác; một số nút không có accessible name từ text/aria-label/title trong phép quét DOM.
- **Bằng chứng/vị trí:** đo trên project screen: “Mở rộng” 10 × 10px; “Mở board project”, “Thao tác project”, “Mở thanh lệnh”, “Settings” 20 × 20px; bốn nút card 15 × 15px không có tên. Card actions dùng `size-icon-xs` và `group-hover:visible` tại `packages/ui/src/components/KanbanCardContent.tsx:254`, `:276`, `:282`. Không tính input ẩn 1px là lỗi.
- **Đề xuất:** tăng hit area (ưu tiên 32–36px desktop, thoáng hơn touch) dù giữ glyph gọn; đặt tên rõ cho icon-only, tooltip kèm phím tắt, focus ring nhất quán.
- **Phạm vi ước lượng:** S–M, 1–2 ngày: dùng chung cho button/sidebar/card.
- **Cách kiểm chứng:** đo hit area thực (không chỉ SVG), duyệt Tab/Shift+Tab, đọc accessible name từ accessibility tree; bấm không nhầm menu/chạy agent ở cạnh nhau.

### UX-04 · P1 · Pane Changes nhìn như trống khi chỉ có header diff

- **Vấn đề:** mở Changes chỉ thấy header file + `+N/-N` + “Open in VS Code”; thân diff bị collapse mặc định, người dùng dễ kết luận pane trống. Nút toggle không thể hiện trạng thái mở/đóng.
- **Bằng chứng/vị trí:** workspace khảo sát, sau khi mở `right-main`: văn bản chỉ `+69` / `Open in VS Code`; `scrollHeight === clientHeight === 851`. `shouldAutoCollapse` tại `packages/web-core/src/pages/workspaces/ChangesPanelContainer.tsx:76`, `collapsed: !expanded` tại `:413`, khởi tạo `initialExpanded = !shouldAutoCollapse(diff)` tại `:615`. Nút file pill `1 file thay đổi` nằm trong `packages/ui/src/components/SessionChatBox.tsx` và không có `aria-pressed`.
- **Đề xuất:** khi có đúng một diff nhỏ, mở sẵn; thêm trạng thái expand rõ ràng và chú thích khi tự collapse (“diff lớn, bấm để mở”); cập nhật `aria-expanded`/`aria-pressed` cho toggle.
- **Phạm vi ước lượng:** S, 0.5–1 ngày.
- **Cách kiểm chứng:** tạo diff nhỏ/lớn và mở Changes; xác minh thân diff hiển thị với diff nhỏ, header có nhãn giải thích với diff lớn; kiểm tra state qua accessibility tree.

### UX-05 · P1 · Settings mở nhưng focus chạy ra nền

- **Vấn đề:** bấm Tab trong Settings không bị giữ trong dialog; focus lần lượt rơi vào composer/board nền, người dùng bàn phím dễ thao tác nhầm.
- **Bằng chứng/vị trí:** mở Settings từ project screen, `document.activeElement` bắt đầu ở Markdown editor nền. Tab trace 45 bước lần lượt: `Agent, model…`, `Đính kèm file`, `Menu project`, `Đang làm`, `Tất cả`, ... rồi mới tới các section Settings; mọi mục báo `dialog:false`. `SettingsDialog.tsx` render qua `createPortal` tại `packages/web-core/src/shared/dialogs/settings/SettingsDialog.tsx:360`, không có focus trap, không có `role=dialog`/`aria-modal`, không focus vào dialog khi mở.
- **Đề xuất:** thêm focus trap, focus ban đầu vào tiêu đề/mục Settings, `role=dialog` + `aria-modal`; khôi phục focus về nút mở khi đóng.
- **Phạm vi ước lượng:** S, 0.5–1 ngày.
- **Cách kiểm chứng:** mở Settings, Tab/Shift+Tab không rời dialog; Escape đóng và focus trở lại nút Settings; kiểm tra bằng accessibility tree.

### UX-06 · P2 · Form tạo issue dài và ba placeholder gây nhiễu

- **Vấn đề:** form chiếm phần lớn màn hình; Workspaces/Relationships/Sub-issues hiển thị placeholder “Lưu issue để thêm…” ngay cả trước khi lưu, khiến form nhìn dài hơn cần thiết.
- **Bằng chứng/vị trí:** create dialog 1440 × 900: khung 576 × 727, nội dung hiển thị đủ nhưng gần lấp màn hình; ba placeholder đều hiện. `CreateIssueDialog.tsx` dùng `max-h-[85vh]` tại `:304`; placeholders trong `packages/web-core/src/shared/dialogs/kanban/CreateIssueLinkedSections.tsx:56`, `:64`, `:72`. Chưa tái hiện cuộn khi Advanced off; nếu Pipeline mở sẽ dễ vượt 85vh.
- **Đề xuất:** gộp ba placeholder thành một dòng “Lưu issue rồi thêm workspace/quan hệ/issue con”; sau khi lưu mới mở rộng các section thật. Giữ autofocus tiêu đề hiện có.
- **Phạm vi ước lượng:** S, 0.5–1 ngày.
- **Cách kiểm chứng:** mở create issue, form ngắn hơn; lưu issue, section thật xuất hiện; chạy với Advanced bật để kiểm tra scroll 85vh.

### UX-07 · P2 · Dialog thiếu ngữ nghĩa ARIA chuẩn

- **Vấn đề:** các modal tạo issue/Settings không có `role=dialog`/`aria-modal`; công cụ trợ năng và test script không nhận diện được dialog.
- **Bằng chứng/vị trí:** DOM create dialog chỉ là `div.fixed.inset-0.z-[10000]`; quét `[role=dialog]` trả rỗng. `KeyboardDialog.tsx` không đặt `role`/`aria-modal`; Settings custom dialog cũng không đặt.
- **Đề xuất:** áp dụng `role=dialog`, `aria-modal=true`, `aria-labelledby`; tái dùng một primitive dialog có focus trap.
- **Phạm vi ước lượng:** S, 0.5 ngày, có thể gộp với UX-05.
- **Cách kiểm chứng:** kiểm tra accessibility tree thấy dialog và accessible name; screen-reader/automated a11y scan không báo modal missing.

### UX-08 · P2 · Giảm nhiễu “Copy as Markdown” và action chỉ hiện khi hover

- **Vấn đề:** nút “Copy as Markdown” lặp lại trên từng tin nhắn/tool-call; một số card actions ẩn cho đến hover, kém khám phá và bất lợi cho touch.
- **Bằng chứng/vị trí:** workspace screen đo được nhiều nút `Copy as Markdown` 32 × 32 cho từng entry. `packages/web-core/src/shared/components/WYSIWYGEditor.tsx:623` render nút này; card actions dùng `group-hover:visible` tại `packages/ui/src/components/KanbanCardContent.tsx:254`, `:276`.
- **Đề xuất:** nhóm copy trong menu context của từng message thay vì nút lặp; hiện action card khi focus/keyboard hoặc dùng hit area luôn thấy nhưng mờ nhẹ.
- **Phạm vi ước lượng:** S, 0.5–1 ngày.
- **Cách kiểm chứng:** đếm số nút copy giảm, focus di chuyển vẫn thấy action; touch không cần hover.

## Ghi nhận chưa khép

- `console.error: Shape sync error: Object` xuất hiện nhiều lần trên project screen nhưng board vẫn render; chưa xác định nguyên nhân/ảnh hưởng, không xếp P0.
- Chưa khảo sát đầy đủ: drag-and-drop thật giữa cột, merge/PR, tạo project với repo thật, thao tác mobile thật. Không thực hiện thao tác huỷ/đổi trạng thái để tránh sửa dữ liệu thật.
- Ảnh/script trong `/tmp/ux/` là bằng chứng tạm, không phải lưu trữ lâu dài; các phép đo và bước tái hiện đã được đưa vào báo cáo này.
