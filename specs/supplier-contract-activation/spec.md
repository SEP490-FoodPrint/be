# Feature Specification: Kích hoạt trước hợp đồng NCC và bỏ tải trùng hồ sơ ATTP

**Branch**: `fix/supplier-contract-activation` | **Nhánh gốc**: `dev` | **Date**: 2026-11-15

## Bối cảnh

Luồng liên kết NCC có hai điểm không khớp thực tế:

1. Hợp đồng chỉ kích hoạt được khi hôm nay nằm trong thời hạn. Trường thường ký gia hạn trước (ví dụ ký cuối tháng 12 cho hợp đồng từ 1/1), nên phải đợi đúng ngày bắt đầu mới kích hoạt được, trong khi đơn cho những ngày đầu phải đặt từ trước.
2. Khi đã chọn chứng nhận ATTP mà NCC tự đăng trên hệ thống, trường vẫn bị bắt tải lại một bản hồ sơ ATTP (`COMPLIANCE`) mới kích hoạt được.

## User Stories

### US1 (P1): Kích hoạt trước hợp đồng bắt đầu trong tương lai

Là BGH, tôi muốn kích hoạt hợp đồng đã ký ngay khi đủ hồ sơ, kể cả khi ngày hiệu lực còn ở phía trước, để việc đặt hàng không bị gián đoạn khi chuyển hợp đồng.

1. Hợp đồng bắt đầu ngày mai, đủ hồ sơ: kích hoạt thành công.
2. Hợp đồng đã hết hạn: vẫn bị chặn kích hoạt.
3. Chứng nhận ATTP được xét tại ngày bắt đầu hiệu lực của hợp đồng nếu ngày đó ở tương lai, nếu không thì xét tại hôm nay.
4. Gửi đơn vẫn xét hợp đồng tại **ngày giao hàng**, nên đơn giao trước ngày bắt đầu hiệu lực vẫn bị chặn.

### US2 (P1): Không bắt tải lại hồ sơ ATTP đã có từ NCC

1. Chọn chứng nhận ATTP của NCC và chỉ có bản hợp đồng đã ký: đủ điều kiện.
2. Chọn căn cứ miễn cấp: bắt buộc tải tài liệu loại `COMPLIANCE`, tức minh chứng miễn cấp hoặc biên bản thẩm định cơ sở.

## Functional Requirements

- **FR-001**: thêm `activationDate(contract, today)`, trả về `startsOn` nếu `startsOn > today`, ngược lại trả về `today`.
- **FR-002**: các thao tác kích hoạt, khôi phục liên kết và trả `issues`/`eligible` trong DTO hợp đồng đều xét tại `activationDate`. Thao tác gửi đơn giữ nguyên, xét theo `requestedDeliveryDate`.
- **FR-003**: chỉ bắt buộc `COMPLIANCE` khi hợp đồng không gắn chứng nhận mà dùng `exemptionNote`. Vẫn nhận tải `COMPLIANCE` (không bắt buộc) khi đã chọn chứng nhận.
- **FR-004**: không đổi schema, quyền, endpoint hay dữ liệu đã có.
