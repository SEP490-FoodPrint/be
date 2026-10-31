# Gửi email dùng chung

Các service backend gọi `sendMail` từ `src/utils/mailer.ts`. Helper dùng Resend và cấu hình RESEND_API_KEY/RESEND_FROM hiện có. Client được tạo khi gửi lần đầu và tái sử dụng; thay API key sẽ tạo client tương ứng. Sender luôn lấy từ cấu hình backend.

## Cách dùng trong service

Ví dụ trong `src/modules/<feature>/<feature>.service.ts`:

```ts
import { sendMail } from "../../utils/mailer";

await sendMail({
  to: recipientEmail,
  subject: "Thông báo cập nhật hồ sơ FoodPrint",
  text: "Hồ sơ của bạn vừa được cập nhật. Vui lòng đăng nhập để xem chi tiết.",
  idempotencyKey: `profile-updated/${eventId}`,
});
```

| Tham số          | Ý nghĩa                                                                         |
| ---------------- | ------------------------------------------------------------------------------- |
| `to`             | Một địa chỉ email hoặc mảng địa chỉ email thuần; khoảng trắng hai đầu được bỏ   |
| `subject`        | Tiêu đề không rỗng, không chứa ký tự xuống dòng                                 |
| `text`           | Nội dung văn bản thuần                                                          |
| `html`           | Nội dung HTML tùy chọn; có thể gửi HTML riêng hoặc cùng text                    |
| `idempotencyKey` | Tùy chọn; khóa ổn định cho cùng một lần gửi để provider nhận diện yêu cầu trùng |

Phải cung cấp ít nhất một nội dung text/HTML không rỗng. Khi dùng HTML, escape dữ liệu người dùng trước khi ghép vào template. Dùng khóa khác nhau cho các mục đích/sự kiện khác nhau; cùng một khóa phải đi với cùng payload. Helper không tự sinh khóa hoặc tự retry.

Hàm trả `{ id }` khi Resend chấp nhận yêu cầu. Kết quả này không bảo đảm email đã tới hộp thư. Timeout cố định là 10 giây. Input không hợp lệ trả HttpError 400; thiếu cấu hình, lỗi provider, mạng hoặc timeout trả HttpError 503. Lỗi provider được làm sạch; helper không log người nhận, nội dung hoặc API key.

## Trách nhiệm của từng tính năng

- Helper quản lý client Resend, sender, timeout, idempotency header và lỗi gửi mail.
- Tính năng quản lý người nhận, tiêu đề/template, sinh mã, hash, TTL Redis, giới hạn gửi và phản hồi nghiệp vụ.
- `verification-email.ts` và `password-reset-email.ts` là các template adapter gọi `sendMail`; các service hiện tại vẫn inject mailer để test.
- Với email thông báo sau một thao tác DB, gửi sau commit và xử lý lỗi theo nghiệp vụ. Lỗi gửi email không có nghĩa thao tác DB đã thất bại. Không gọi trực tiếp SDK Resend ở service mới.

## Kiểm thử

`npm run test:mailer` kiểm tra text/HTML, nhiều người nhận, idempotency, timeout, lỗi provider/mạng, cấu hình và input với fetch được thay trong test. Không gửi email thật. Nhóm này nằm trong `npm run test:unit`; các test xác minh email và quên mật khẩu tiếp tục kiểm tra nội dung và khóa theo từng mục đích. Chạy `npm run validate` để kiểm tra lint, format, typecheck và build.
