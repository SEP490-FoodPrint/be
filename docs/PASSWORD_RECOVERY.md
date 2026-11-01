# Đổi mật khẩu và khôi phục mật khẩu

## API và luồng frontend

Các endpoint dùng JSON, envelope chuẩn, `Cache-Control: no-store` và header `X-CSRF-Protection: 1`. Origin trình duyệt phải khớp CLIENT_URL. Không truyền mật khẩu, mã hoặc token trong URL. Frontend hiển thị form; repository này cung cấp backend API.

| API                                   | Body                               | Kết quả                                                                                           |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| POST /api/auth/change-password/verify | `{ currentPassword }`              | Cần phiên đăng nhập; trả `{ verified: true }` nếu mật khẩu cũ đúng, không đổi mật khẩu hoặc phiên |
| POST /api/auth/change-password        | `{ currentPassword, newPassword }` | Cần phiên đăng nhập; kiểm tra mật khẩu cũ rồi đổi mật khẩu                                        |
| POST /api/auth/forgot-password        | `{ email }`                        | Gửi/gửi lại mã 6 chữ số qua Resend; data `{ expiresIn: 600, resendAfter: 60 }`                    |
| POST /api/auth/forgot-password/verify | `{ email, code }`                  | Mã đúng trả `{ resetToken, expiresIn: 300 }`; chưa đổi mật khẩu                                   |
| POST /api/auth/reset-password         | `{ resetToken, newPassword }`      | Đặt mật khẩu mới; không tự đăng nhập                                                              |

Quên mật khẩu có ba màn hình: nhập email → nhập mã → nhập mật khẩu mới. Chỉ mở bước nhập mật khẩu sau verify thành công. Giữ resetToken trong bộ nhớ của màn hình và gửi ở body của reset-password; không lưu localStorage/sessionStorage hoặc log token. Tải lại trang hoặc token hết hạn thì thực hiện lại luồng. `code` là chuỗi để giữ số 0 đầu, ví dụ `"012345"`.

Đổi mật khẩu có hai bước: gọi change-password/verify trước khi mở hai trường mật khẩu mới và xác nhận. Bước verify chỉ đọc, dùng chung giới hạn đoán mật khẩu, kiểm tra tài khoản từ phiên và không tạo/thu hồi phiên. Khi lưu, vẫn gửi currentPassword và newPassword đến change-password để kiểm tra lại trong transaction; verified trên frontend không phải quyền đổi mật khẩu.

Đổi mật khẩu dùng `credentials: "include"`; backend lấy tài khoản từ phiên, không nhận userId/email đích. `currentPassword` sai trả 400 và giữ nguyên mật khẩu/phiên. Mật khẩu mới dùng cùng quy tắc signup: ít nhất 8 ký tự Unicode, có chữ thường, chữ hoa, chữ số (0–9) và ký tự đặc biệt (dấu câu hoặc ký hiệu, ví dụ !, @, #); tối đa 72 byte UTF-8, không trim và phải khác mật khẩu cũ. Khoảng trắng không thay thế ký tự đặc biệt. Ví dụ hợp lệ: `Food123!`. Có thể dùng ô xác nhận mật khẩu ở frontend nhưng chỉ gửi newPassword đã xác nhận.

Sau đổi/reset thành công, backend thu hồi mọi phiên cũ, xóa cookie trên trình duyệt gọi API và yêu cầu đăng nhập lại. Response không chứa password hash hoặc token đăng nhập. Redis giữ hash refresh token như trước; cookie access/refresh vẫn HttpOnly.

## Mã email và giới hạn

- Gửi mã cho tài khoản ACTIVE hoặc UNVERIFIED; không gửi cho tài khoản khóa/ngừng hoạt động. Response thành công giống nhau cho email tồn tại, không tồn tại hoặc không đủ điều kiện. Email được trim/lowercase. Khôi phục không xác minh email, kích hoạt tài khoản, duyệt hồ sơ hoặc đổi quyền.
- Mã ngẫu nhiên có hiệu lực 10 phút, tối đa 5 lần nhập sai và dùng một lần. Gửi lại cách nhau 60 giây; tối đa 5 yêu cầu/email/giờ và 20 yêu cầu/IP/giờ, kể cả email không tồn tại. Mã mới thay challenge cũ.
- Reset token ngẫu nhiên có hiệu lực 5 phút, dùng một lần, gắn vào đúng tài khoản/email/phiên bản password hash. Mã và reset token cũ mất hiệu lực khi mật khẩu thay đổi. Mã xác minh email đăng ký không dùng được cho khôi phục mật khẩu.
- Đổi mật khẩu giới hạn 5 lần thử/15 phút/tài khoản. Vượt giới hạn trả 429 với Retry-After. Global API limiter và CSRF vẫn áp dụng.
- Redis dùng namespace riêng `foodprint:password-reset:`. Code được lưu bằng HMAC-SHA256; grant lưu dưới key SHA-256 của resetToken, không lưu mã/token/email thô. Lua và GETDEL bảo đảm tiêu thụ nguyên tử. Không flush hoặc xóa wildcard.
- Redis/Resend lỗi trả 503, không có fallback hoặc mã cố định. Resend lỗi sẽ hủy đúng challenge vừa tạo nhưng giữ giới hạn gửi. Sau khi code/grant được tiêu thụ, lỗi DB/Redis ở bước tiếp theo yêu cầu bắt đầu lại; không tự khôi phục token đã dùng.

## Thu hồi phiên và tính nhất quán

Redis lưu generation của mỗi user đã đổi mật khẩu tại `foodprint:auth:session:user:<uuid>`. Session mới được gắn generation nguyên tử; đọc/refresh phiên so sánh generation hiện tại. Phiên cũ, kể cả record trước khi có generation, bị từ chối sau khi user đổi mật khẩu. Key generation không đặt TTL; các session bị vô hiệu tự hết hạn theo TTL riêng. Đây là trạng thái thu hồi phiên, không phải cache quyền.

Login và thay mật khẩu khóa cùng hàng users trong transaction. Login kiểm tra lại password hash sau khi có khóa, tránh tạo phiên mới bằng mật khẩu đã hết hiệu lực. Thay mật khẩu kiểm tra lại trạng thái/identity hiện tại, xác minh mật khẩu hoặc grant, thu hồi phiên Redis rồi mới ghi password hash bcrypt cost 12. Redis lỗi thì rollback DB. Nếu transaction rollback sau thu hồi, mật khẩu cũ vẫn giữ nhưng các phiên có thể đã bị đăng xuất; đăng nhập lại hoặc bắt đầu lại khôi phục. Không giả định Redis và PostgreSQL có transaction phân tán.

## Cấu hình và kiểm thử

Dùng lại RESEND_API_KEY và RESEND_FROM đã cấu hình cho xác minh email; sender/domain và giới hạn môi trường thử của Resend vẫn áp dụng. Không cần secret, bảng hoặc migration mới. Task không gửi email thật khi test; provider được inject/thay fetch.

Template `password-reset-email.ts` gọi [sendMail dùng chung](MAILER.md). Tính năng khác gửi email bằng helper này; mã OTP, reset grant, TTL và giới hạn riêng tiếp tục do password service quản lý.

- `npm run test:password`: unit/HTTP, validation, mã/token, session revocation, lỗi provider/Redis.
- `npm run test:unit`: bao gồm password tests.
- `npm run test:auth:redis`: session generation, phiên cũ/mới, thu hồi và cô lập user trên Redis local.
- `npm run test:authorization`: luồng thật qua HTTP, PostgreSQL/Redis local dùng một lần, reset đồng thời, đổi mật khẩu và login đồng thời, rollback khi thu hồi phiên lỗi.
- `npm run validate`: lint, format, typecheck và build.
