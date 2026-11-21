# Danh mục đơn vị tính và cảnh báo nhập hàng

Danh mục toàn hệ thống có mã/ký hiệu/nhóm bất biến, tên, bước khuyến nghị Decimal(14,3)>0, trạng thái và alias chuẩn hóa duy nhất. System Admin có measurement_unit.manage quản lý; mọi tài khoản đã đăng nhập đọc được không cần quyền danh sách riêng (ngoại lệ danh mục dùng chung theo yêu cầu người dùng). Không có API xóa hoặc cấu hình hệ số quy đổi.

Migration kiểm kê chuỗi cũ, tạo danh mục và alias, backfill ingredients.unit_id nullable, bảo toàn default_unit và lịch sử. kg/l bước 0.1, g/ml 1, quả 0.5, miếng/đếm khác 1; OTHER 0.001. Giữ chuyển đổi g/kg ml/l trong code. Nguyên liệu/công thức mới chỉ nhận đơn vị đang hoạt động; chỉnh bản ghi cũ không đổi đơn vị cho phép giữ đơn vị ngừng dùng.

GET /api/measurement-units (search, group, status, page, limit), GET /:id yêu cầu đăng nhập. POST và PATCH /:id yêu cầu System Admin + measurement_unit.manage và kiểm tra lại actor trong transaction. PATCH chỉ name/recommendedStep/status. Decimal trả chuỗi. Alias được nhập khi tạo, bất biến sau tạo; code/symbol tự là alias. Trùng alias/code trả 409.

FE có /system/measurement-units và sidebar. Service riêng, MUI/SCSS/token. Bộ chọn nguyên liệu/công thức lấy danh mục, giữ giá trị cũ. Nhập hàng tươi/đợt bổ sung/khô không tự ceil theo đơn vị đếm. Bội số sai chỉ cảnh báo vàng và hai giá trị lân cận dương, không thay dữ liệu, không chặn gửi. Chính xác đến 3 chữ số thập phân; âm/0/định dạng sai vẫn chặn. Không tải được danh mục thì cho tải lại và vẫn nhập/gửi như hiện hữu. Quy tắc không áp lên định lượng mỗi suất.
