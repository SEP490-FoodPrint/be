# Xác minh email bằng Resend

## Luồng đăng ký

1. `POST /api/auth/signup` tạo tài khoản UNVERIFIED, emailVerifiedAt=null, chưa tạo hồ sơ hoặc cookie đăng nhập; sau commit yêu cầu Resend gửi mã 6 chữ số.
2. Frontend hiển thị màn hình nhập mã. Người dùng nhập mã nhận trong email hoặc yêu cầu gửi lại.
3. Xác minh thành công chỉ ghi emailVerifiedAt; tài khoản vẫn UNVERIFIED. Người dùng đăng nhập để hoàn thiện/nộp hồ sơ theo [ONBOARDING.md](ONBOARDING.md).
4. System Admin duyệt hồ sơ mới tạo tổ chức và chuyển tài khoản ACTIVE. Xác minh email không tự gắn tổ chức, cấp quyền hoặc đăng nhập.

Tài khoản UNVERIFIED chưa xác minh email bị chặn login, refresh và các API phiên/hồ sơ bằng 403. Các phiên cũ không được dùng để bỏ qua bước này. Tài khoản ACTIVE hiện có vẫn dùng quy tắc trạng thái/membership/quyền trước đây, kể cả bản ghi cũ emailVerifiedAt=null; thay đổi này không tự xác minh hoặc khóa tài khoản cũ.

## API

Cả hai endpoint dưới đây dùng trước login. Body phải là JSON; POST cần `X-CSRF-Protection: 1` và Origin phù hợp CLIENT_URL khi trình duyệt cung cấp. Không truyền mã trong URL hoặc query string.

| API                                       | Body            | Kết quả                                                                    |
| ----------------------------------------- | --------------- | -------------------------------------------------------------------------- |
| POST /api/auth/email-verification/request | { email }       | Gửi/gửi lại; thông báo chung, data={ expiresIn: 600, resendAfter: 60 }     |
| POST /api/auth/email-verification/verify  | { email, code } | data={ emailVerified: true, accountStatus: "UNVERIFIED" }; không cấp token |

Email được trim/lowercase. `code` phải là chuỗi đúng 6 chữ số để giữ số 0 đầu, ví dụ "012345". Trường lạ bị trả 400. Request gửi lại dùng cùng response cho email không tồn tại, đã xác minh hoặc ngoài luồng đăng ký; chỉ tài khoản UNVERIFIED của SCHOOL_ADMINISTRATION/INGREDIENT_SUPPLIER_ADMIN chưa xác minh được nhận email.

```ts
await fetch("http://localhost:5000/api/auth/email-verification/verify", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Protection": "1",
  },
  body: JSON.stringify({ email, code }),
});
```

Response signup giữ `user` và `onboardingRequired: true`, bổ sung `emailVerificationRequired: true` và `verificationEmailSent`. Giá trị true nghĩa là Resend đã chấp nhận yêu cầu, chưa bảo đảm email đã tới hộp thư. Nếu gửi thất bại, signup vẫn trả 201 với verificationEmailSent=false vì tài khoản đã được tạo; frontend dùng endpoint request thay vì đăng ký lại. Lỗi tạo tài khoản vẫn giữ 409/503 như trước.

## Mã và giới hạn

- Dùng crypto.randomInt, mã có hiệu lực 10 phút và dùng một lần. Redis chỉ giữ HMAC-SHA256 cùng userId, nonce, attempts và expiresAt; không lưu mã thô hoặc địa chỉ email.
- HMAC dùng JWT_SECRET với chuỗi phân biệt mục đích, gắn mã vào đúng email/tài khoản/nonce. Đổi JWT_SECRET làm các mã cũ mất hiệu lực.
- Mỗi mã được thử tối đa 5 lần; dùng sai đủ số lần sẽ xóa mã. Sai/hết hạn/đã dùng trả cùng lỗi 400. Hai yêu cầu xác minh đồng thời chỉ một yêu cầu được tiêu thụ mã.
- Gửi lại cách nhau ít nhất 60 giây, tối đa 5 yêu cầu/email/giờ và 20 yêu cầu/IP/giờ. Áp dụng giới hạn cả email không tồn tại/đã xác minh. IPv6 được gom bằng ipKeyGenerator; trust proxy của app vẫn false. Global API limiter vẫn chạy.
- Hạn gửi lại trả 429 và Retry-After. Lỗi Redis/Resend hoặc cấu hình Resend trả 503; không có fallback memory hoặc mã cố định. Khi Resend lỗi sau khi cấp mã, backend xóa đúng challenge vừa tạo và giữ các giới hạn chống gửi hàng loạt.
- Mã được tiêu thụ nguyên tử ở Redis trước khi cập nhật PostgreSQL. Nếu PostgreSQL lỗi sau bước này, request trả 503 và cần gửi lại mã; không tự đổi status. Namespace riêng là foodprint:email-verification:, chỉ thao tác đúng key, không flush/wildcard deletion.

Response xác minh/gửi mã dùng Cache-Control: no-store. Không trả hoặc log mã, API key, HMAC hay nội dung lỗi provider. Email gửi bằng text, có timeout 10 giây và idempotency key theo nonce. Không tạo queue/worker hoặc thay đổi Prisma schema/migration.

## Cấu hình và test

Thêm vào `.env` riêng dựa trên `.env.example`:

```dotenv
RESEND_API_KEY=re_your_actual_api_key
RESEND_FROM=FoodPrint <no-reply@your-verified-domain.example>
```

Thay toàn bộ placeholder; dùng sender thuộc domain đã verify trong Resend. [Hướng dẫn Resend Node.js](https://resend.com/docs/send-with-nodejs) yêu cầu API key và verified domain; [idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) tránh gửi trùng khi retry cùng request. Giữ API key trong backend, không đưa vào frontend hoặc commit. Task này không tự sửa `.env`, cấu hình domain hay gửi email tới địa chỉ thật chưa được chọn để thử.

`npm run test:email` chạy unit/HTTP và kiểm tra request SDK bằng fetch được thay trong test, không gửi email thật. `npm run test:unit` bao gồm nhóm này. `npm run test:authorization` kiểm tra signup → email verification → login → nộp/duyệt hồ sơ với PostgreSQL/Redis local tạm, provider email/tệp được inject. Test dùng namespace Redis riêng, dọn đúng key tự tạo. Chạy `npm run validate` để kiểm tra lint/format/types/build.
