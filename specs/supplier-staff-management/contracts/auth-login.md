# HTTP Contract: Email-only Login cho toàn hệ thống

**Updated**: 2026-11-17. Áp dụng mọi vai trò theo FR-009/SC-007 của [spec](../spec.md), thay thiết kế trước vốn chỉ email-only riêng staff. Endpoint/field/envelope phiên giữ hiện có; ý nghĩa identifier nay chỉ là email. Runtime đã triển khai theo contract; bằng chứng local tại [quickstart](../quickstart.md).

## POST /api/auth/login

Body strict gồm đúng identifier/password:

```json
{
  "identifier": "account@example.test",
  "password": "Example123!"
}
```

Đây là dữ liệu minh họa, không phải fixture được tạo tự động. SYSTEM_ADMIN, các role SCHOOL, SUPPLIER và AUTHORITY đều gửi email trong identifier; không có nhánh username cho bất kỳ role nào. Không nhận email field thay thế, username field, orgId/supplierId/schoolId/role/orgType, mã hoặc link tổ chức. Trường lạ trả 400; không thêm endpoint riêng hoặc phương thức chọn loại định danh.

identifier giữ requiredText(320), trim và lowercase; không rỗng, không vượt giới hạn chuỗi hiện có. Không thêm validator định dạng email trong lần này: chuỗi username/non-email không rỗng vẫn được hiểu là giá trị cần đối chiếu email và nhận 401 nếu không có account. Password nguyên văn, login 1–72 byte UTF-8, không trim hoặc áp quy tắc mật khẩu mới vào login tài khoản cũ. Thiếu/rỗng/sai kiểu/quá dài và extra field là 400 theo validation chung.

## Quy tắc chọn danh tính

| Giá trị identifier                                                     | Kết quả lookup và xác thực                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Email duy nhất của bất kỳ role, password đúng, trạng thái đủ điều kiện | Xác thực đúng chủ email, tổ chức/quyền nạp lại từ DB                                                                   |
| Email viết hoa/thường khác nhau hoặc khoảng trắng ngoài                | Chuẩn hóa, vẫn xét cùng một chủ email                                                                                  |
| Username hợp lệ/duy nhất nhưng không khớp email nào                    | 401 chung, không fallback username, không cấp phiên                                                                    |
| Email A đồng thời là username của B                                    | Chỉ A được xét; password chỉ đúng với B mà không đúng với A phải 401; không lỗi nhiều account hoặc chọn B qua username |
| Chuỗi username của A đồng thời chính là email B                        | Chuỗi chỉ mang nghĩa email B; không có đường xác thực A bằng username                                                  |
| Email không tồn tại hoặc password sai                                  | 401 chung “Email hoặc mật khẩu không đúng”; không phân biệt có/không có email                                          |

Repository dùng unique-email lookup Citext, trả candidate hoặc null; không OR với username, không role filter hoặc take:2/ambiguity logic. Chỉ passwordHash của chủ email được so; khi account không tồn tại vẫn dummy bcrypt comparison. Username vẫn lưu/hiển thị theo data contract, không ảnh hưởng login khi trùng nhau hoặc trùng email người khác.

## Kiểm tra lại trong transaction

Khóa User theo id rồi đọc lại với id + email trong cùng transaction, dùng Citext matching ở DB. Email đã đổi hoặc hash khác lúc lookup phải trả 401 trước khi cấp phiên; không dùng predicate username để cứu lookup cũ. Sau đó loadSessionUser kiểm tra role/membership/status/onboarding hiện hành. Không cache role/permissions hoặc lấy scope từ login body.

## Response, status và session

Success 200 giữ envelope và data user/expiresIn hiện hành; token chỉ qua HttpOnly cookie, không thêm token JSON. User DTO vẫn có username/email/role/tổ chức, không đổi User.id hoặc tạo registration vì login. Cache headers, cookie flags/path, CORS/CSRF, refresh rotation, logout và rate limit giữ nguyên.

- ACTIVE hợp lệ truy cập theo role/membership/permissions hiện hành; không tự yêu cầu emailVerifiedAt mới cho ACTIVE cũ/staff.
- UNVERIFIED admin SCHOOL/SUPPLIER chỉ đăng nhập onboarding theo điều kiện xác minh email hiện hành, không có quyền nghiệp vụ. UNVERIFIED chưa xác minh và staff UNVERIFIED vẫn bị chặn theo policy hiện có.
- LOCKED/INACTIVE/DEACTIVATED bị chặn theo auth contract hiện hành; credential đúng đi tới status check 403, credential sai là 401. Email-only không tự kích hoạt account hoặc gỡ intake suspension.
- Refresh, /me và logout tiếp tục session User.id; email-only không yêu cầu revoke toàn bộ phiên đang còn sống. Khóa tài khoản chặn ở lần kiểm tra tiếp theo; unlock bảo đảm login email mới, không hứa phục hồi phiên cũ.

Không sửa JWT sub/sid, tăng quyền role hoặc bỏ tenant scope vì đổi định danh đăng nhập.

## Password recovery

Giữ request/verify/reset contracts tại docs/PASSWORD_RECOVERY.md. Email unique toàn cục chọn đúng account; grant/code/fingerprint/revoke gắn đúng User.id/email như hiện tại. Reset email A không đổi password/phiên B có cùng username; không cần tổ chức hoặc username để khôi phục. Chỉ chạy test disposable đã được phép, không gửi email thật trong bước plan.

## Compatibility và hồi quy

Đây là thay đổi chủ đích cho tất cả client/role đang dùng username login: chuyển sang email đã có, không đổi account data hoặc fallback username trong rollout. Tên field identifier được giữ để giảm thay đổi giao tiếp, nhưng tài liệu/placeholder/thông báo đăng nhập phải ghi email. Quy tắc uniqueness username khi tạo account vẫn giữ như [data model](../data-model.md).

Regression SC-007 phải bao phủ từng role trong ROLES, không chỉ mỗi orgType: email thành công khi đủ điều kiện, username-only 401, normalize email, cross-field collision chọn chủ email đúng và password chỉ đúng với người kia bị từ chối, email/hash đổi giữa lookup/lock, status/onboarding/permissions và session/recovery giữ nguyên. Positive login fixture/helper của mọi role chuyển sang email; username vẫn được kiểm ở create/DTO/uniqueness hoặc negative login. Không giữ kỳ vọng “ambiguity 401” khi email trùng username.

Các fixture cross-field collision phải dùng mật khẩu A/B khác nhau để kiểm việc chọn danh tính. Nếu hai tài khoản tình cờ có cùng giá trị mật khẩu, xác thực vẫn chỉ kiểm hash của chủ email; hệ thống không suy luận nguồn gốc giá trị mật khẩu từ tài khoản khác.
