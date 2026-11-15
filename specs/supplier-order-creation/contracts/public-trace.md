# HTTP Contract: Truy xuất QR công khai theo dòng

## Point lookup được công khai

`GET /api/public/delivery-items/:token`, không cần token đăng nhập, không có endpoint list/search. Token là64 ký tự hex lowercase ngẫu nhiên, lookup `DeliveryItem.qrToken` globally unique, chỉ row có parent traceabilityVersion1 và đủ snapshot/URL được công khai. Không dùng IngredientLot.qrToken, ingredientId hoặc deliveryNo làm khóa công khai.

Query phải rỗng; không nhận include/expand/supplierId hoặc trường chọn tùy ý. Token sai shape/không tồn tại hoặc legacy không đủ public data trả cùng404 “Không tìm thấy thông tin truy xuất”. Bản ghi đã hủy/reject vẫn truy xuất được với đúng trạng thái; không hiển thị là đã nhận đạt chỉ vì QR tồn tại. Cơ sở đã dừng không làm mất snapshot đã công bố.

## Biểu diễn và danh sách cho phép

- `Accept: application/json` (hoặc mặc định client `*/*`):200 JSON success envelope; data chỉ có supplierName, deliveryNo, status, statusLabel, ingredientName, actualQuantity (chuỗi), unit, sourceFacility `{name,facilityCode|null}`.
- Browser chấp nhận `text/html`:200 HTML tối thiểu đọc được trên điện thoại, cùng danh sách dữ liệu; có tiêu đề “Truy xuất nguyên liệu”, tên tiếng Việt và trạng thái dễ hiểu. Không có JS/form/approve/links tra cứu đơn khác. Controller dùng helper HTML từ dữ liệu đã allowlist, không import DTO hoặc query DB. HTML là ngoại lệ biểu diễn đã ghi rõ, JSON luôn giữ shared envelope.
- Accept không hỗ trợ406. HEAD tương đương GET headers, không side effect.
- Không trả internal IDs, raw token/URL, trường nhận, xe, lịch giao, contacts, user, request, giá/hợp đồng, photos, chữ ký hoặc decision details; không nhúng chúng vào HTML hidden attributes/metadata hoặc error text.

Tên nguyên liệu và tên/mã source là snapshots lúc tạo, supplierName lấy tên công khai của supplier; status đọc trạng thái hiện hành. FacilityCode null hiển thị “Chưa có mã cơ sở” cùng tên, không tự tạo mã để đủ nhãn. Không có badge blockchain/đã xác thực nếu chỉ có QR thông thường; không sử dụng TraceabilityAnchor để suy ra phê duyệt.

## URL và render nhãn

Cấu hình mới `PUBLIC_TRACE_ORIGIN`: origin tuyệt đối không credentials/query/hash/path ngoài `/`, production HTTPS; local HTTP chỉ loopback cho dev. Startup kiểm giá trị hợp lệ trước bật create v1; tests inject config tường minh. URL tạo từ origin cấu hình + fixed path + token, không lấy Host/X-Forwarded-Host. Lưu qrUrl vào item, luôn render lại từ URL đã lưu; thay env không được viết lại URL cũ. Operator cần duy trì hostname/path cũ cho nhãn đã in. Localhost QR chỉ hoạt động trên máy chủ; để điện thoại quét thật phải có HTTPS origin mà thiết bị truy cập được.

QR helper tạo PNG với options cố định (`errorCorrectionLevel: M`, margin4, width384); không gửi dữ liệu tới QR service bên thứ ba, không upload lên Cloudinary. Lấy/in nhiều bản nhãn cùng dòng giữ cùng encoded URL; không hứa tracking từng bao bì hay độ bền vật lý nhãn.

## Rate limit, headers, lỗi

Route nằm trong `/api`, tiếp tục limiter Redis shared300/phút/IP mặc định, không skip và không fallback memory. Lỗi Redis trả503 theo policy; public lookup lỗi DB503 generic, không lộ URL/SQL/token. Không thêm auth middleware khiến public thành401.

Cả HTML/JSON dùng `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex, nofollow`. HTML dùng CSP `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`, escape tất cả text, không ảnh/script/style bên ngoài. Error HTML cũng escape và cùng headers, không dump request. Access/error logging che token path; không đổi mức log toàn app chỉ vì thêm endpoint này.

Invalid token/not found404 và unsupported Accept406 không xác nhận sự tồn tại record khác. Công khai là chủ ý theo Q2: ai có QR đều đọc được allowlist, không phải cơ chế xác thực bao bì hoặc quyền kiểm nhận. Chưa có rotate/revoke token hoặc expiration trong spec; không tự làm nhãn cũ hết hạn.
