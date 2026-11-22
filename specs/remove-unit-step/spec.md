# Spec: Bỏ bước khuyến nghị của đơn vị đo

## Bối cảnh

- Đơn vị đo có "bước khuyến nghị" (ví dụ kg = 0,1). Khi đặt hàng, số lượng lẻ bị cảnh báo và gợi ý làm tròn; người dùng làm tròn xuống (27,72 kg thành 27,7 kg) dẫn tới thiếu nguyên liệu khi nấu.

## Yêu cầu chức năng

- **FR-001**: Bỏ trường `recommendedStep` của đơn vị đo. `POST /measurement-units` và `PATCH /measurement-units/:id` không nhận trường này (gửi lên bị 400 như trường lạ); phản hồi không còn trường này.
- **FR-002**: Migration `20261129000100_drop_unit_recommended_step` xoá cột `measurement_units.recommended_step` và ràng buộc `measurement_units_step_positive`.
- **FR-003**: Số lượng đặt hàng giữ nguyên giá trị nhập (tối đa 3 chữ số thập phân), không cảnh báo hay gợi ý làm tròn. Kiểm tra lỗi nhập (trống, không dương, quá 3 chữ số thập phân) giữ nguyên.

## Ngoài phạm vi

- Danh mục đơn vị đo (mã, tên, ký hiệu, nhóm, alias, trạng thái) giữ nguyên.
