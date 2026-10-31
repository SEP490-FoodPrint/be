# Đăng ký, đăng nhập và phiên Redis

## API và dữ liệu đăng ký

| API                            | Nội dung                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `POST /api/auth/signup`        | Tạo user UNVERIFIED để hoàn thiện hồ sơ, chưa tạo yêu cầu duyệt; trả 201     |
| `POST /api/auth/login`         | Kiểm tra mật khẩu và trạng thái tài khoản, tạo phiên Redis và đặt cookie     |
| `POST /api/auth/refresh`       | Đọc refresh cookie, kiểm tra phiên/user, đổi refresh token và đặt lại cookie |
| `POST /api/auth/logout`        | Thu hồi phiên hiện tại và xóa cả hai cookie                                  |
| `GET /api/auth/me`             | Thông tin tài khoản, status, onboardingRequired và trạng thái hồ sơ          |
| `PATCH /api/auth/me`           | Cập nhật fullName/phone của chính tài khoản đang đăng nhập                   |
| `GET /api/auth/me/permissions` | Quyền hiệu lực khi ACTIVE; UNVERIFIED nhận mảng rỗng                         |

Đổi mật khẩu và khôi phục bằng mã email có các API change-password, forgot-password, forgot-password/verify và reset-password; xem [PASSWORD_RECOVERY.md](PASSWORD_RECOVERY.md) để biết body, ba bước frontend và chính sách thu hồi mọi phiên sau khi đổi mật khẩu.

Request đăng ký tối thiểu:

```json
{
  "username": "new_school_admin",
  "email": "school-admin@example.test",
  "password": "School123!",
  "fullName": "Nguyễn Văn A",
  "requestType": "SCHOOL"
}
```

`requestType` tương ứng hai tab SCHOOL/SUPPLIER. Backend chọn role SCHOOL_ADMINISTRATION/INGREDIENT_SUPPLIER_ADMIN, không nhận roleId, status hoặc ID tổ chức từ client. Signup tạo tài khoản UNVERIFIED trong transaction, chưa gắn tổ chức, chưa tạo RegistrationRequest và chưa cấp cookie. Sau commit, Resend gửi mã xác minh email. Người dùng xác minh email rồi login để hoàn thiện hồ sơ, không cần chờ System Admin duyệt. Không tự tạo tài khoản SYSTEM_ADMIN hoặc ATTP qua signup.

Username dài 3–120 ký tự, gồm chữ/số/underscore/dấu chấm/gạch ngang và bắt đầu bằng chữ/số. Email được trim/lowercase. Mật khẩu mới tối thiểu 8 ký tự, có chữ thường, chữ hoa, chữ số (0–9) và ký tự đặc biệt (dấu câu hoặc ký hiệu, ví dụ !, @, #); tối đa 72 byte UTF-8; bcrypt cost 12. Login giữ giới hạn 1–72 byte cho các tài khoản đã tồn tại. `phone` tùy chọn, tối đa 30 ký tự. Signup chỉ nhận các trường tài khoản ở trên và phone; profileData, supportingDocuments hoặc trường lạ đều trả 400.

Response signup chứa `user: { id, username, fullName, status: "UNVERIFIED" }`, `onboardingRequired: true`, `emailVerificationRequired: true` và `verificationEmailSent`. Nếu gửi email lỗi sau khi tạo tài khoản, vẫn trả 201 với verificationEmailSent=false; dùng API gửi lại thay vì đăng ký lại. Username/email trùng trả 409 với thông báo chung; lỗi DB trả 503, không trả URL hoặc lỗi driver. Xem [gửi/nhập mã, Resend và giới hạn](EMAIL_VERIFICATION.md).

## Hoàn thiện hồ sơ và duyệt tài khoản

Luồng nghiệp vụ đã chốt:

```text
Đăng ký → tài khoản UNVERIFIED → xác minh email → đăng nhập để hoàn thiện hồ sơ
  → nộp hồ sơ hợp lệ → hồ sơ PENDING, tài khoản vẫn UNVERIFIED
  → System Admin duyệt → hồ sơ APPROVED, tài khoản ACTIVE và gắn tổ chức hợp lệ
```

UNVERIFIED được xem `/auth/me`, `/auth/me/permissions`, hồ sơ/tài liệu của mình, nộp hồ sơ, refresh và logout; không có quyền nghiệp vụ hoặc quản trị dù role được gán quyền. `/me` trả onboardingRequired=true, không có thuộc tính permissions; registrationRequest=null nếu chưa nộp, hoặc tóm tắt id/status/submittedAt/rejectionReason nếu đã tồn tại. LOCKED/INACTIVE/DEACTIVATED không được login/refresh. Với ACTIVE, `/me` trả onboardingRequired=false cùng quyền hiện tại, vẫn kiểm tra membership.

API nộp/xem hồ sơ, upload tài liệu và duyệt/từ chối đã triển khai theo hai form Figma được xác nhận; xem [ONBOARDING.md](ONBOARDING.md) để biết các trường, multipart và quyền xét duyệt. Hoàn thiện/nộp hồ sơ không tự chuyển ACTIVE. Thao tác duyệt tạo tổ chức, chuyển chứng nhận và kích hoạt tài khoản trong cùng transaction. UNVERIFIED phải có emailVerifiedAt mới login/refresh/truy cập hồ sơ; [xác minh email](EMAIL_VERIFICATION.md) không chuyển ACTIVE. Tài khoản ACTIVE cũ tiếp tục dùng quy tắc trước đây.

## Hồ sơ cá nhân

`GET /api/auth/me` trả thông tin phiên tin cậy, bổ sung email và phone cho trang hồ sơ cá nhân. `PATCH /api/auth/me` cập nhật từng trường của chính tài khoản; không nhận userId từ client và không yêu cầu quyền quản trị user.manage. Cả tài khoản ACTIVE hợp lệ và tài khoản UNVERIFIED đã xác minh email đều được dùng API này.

```json
{
  "fullName": "Nguyễn Văn A",
  "phone": "0901234567"
}
```

Frontend gửi cookie bằng credentials include, Content-Type application/json và `X-CSRF-Protection: 1`. Cần ít nhất một trong hai trường; trường không gửi được giữ nguyên. fullName được trim, không nhận null/rỗng và tối đa 255 ký tự. phone được trim, tối đa 30 ký tự; gửi null hoặc chuỗi rỗng/khoảng trắng để xóa số điện thoại.

API trả 200 với cùng cấu trúc data như GET /me, dùng Cache-Control: no-store và không cấp lại cookie/token. Request kế tiếp đọc thông tin mới từ DB. Hệ thống kiểm tra lại tài khoản trong transaction Serializable trước khi ghi, chỉ cập nhật fullName/phone; Prisma tự cập nhật updatedAt.

Trường lạ hoặc body rỗng trả 400. Email, username, password/passwordHash, role, status, permissions, ID tổ chức và emailVerifiedAt không được sửa bằng API này. Schema hiện chưa có avatar hoặc ngày sinh; API không nhận các trường đó. Thiếu/hết hạn/thu hồi phiên trả 401; tài khoản bị khóa/ngừng hoạt động hoặc UNVERIFIED chưa xác minh email trả 403; lỗi DB trả 503. Thay đổi thông tin cá nhân không sửa RegistrationRequest, School hoặc Supplier, không kích hoạt tài khoản và không thay đổi quyền.

Kiểm thử nằm trong `npm run test:auth`/`npm run test:unit`; `npm run test:authorization` kiểm tra quyền sở hữu, field được bảo vệ và chặn tài khoản bị khóa bằng PostgreSQL/Redis local tạm.

## Access token và refresh token nằm ở đâu?

| Thành phần                     | Vị trí                               | Cấu hình                                                          |
| ------------------------------ | ------------------------------------ | ----------------------------------------------------------------- |
| Access JWT                     | Cookie `foodprint_access`            | HttpOnly, SameSite=Lax, Path=/api, mặc định 15 phút               |
| Refresh token ngẫu nhiên       | Cookie `foodprint_refresh`           | HttpOnly, SameSite=Lax, Path=/api/auth, mặc định tối đa 7 ngày    |
| Hash SHA-256 của refresh token | Redis `foodprint:auth:session:<sid>` | Kèm userId và expiresAt; TTL tuyệt đối, không kéo dài sau refresh |

Cookie là host-only, không đặt Domain; Secure bật khi NODE_ENV=production, cần HTTPS. Local HTTP dùng NODE_ENV=development. SameSite=Lax phù hợp frontend/API cùng site; cấu hình CORS riêng không làm cookie hoạt động giữa các site khác nhau. `CLIENT_URL` phải khớp origin frontend, ví dụ `http://localhost:3001`.

Login/refresh chỉ trả `{ user, expiresIn }` bên trong envelope chuẩn; token chỉ được đặt qua Set-Cookie. Frontend dùng credentials include và để trình duyệt quản lý cookie, không đọc hoặc chép token sang localStorage/sessionStorage. Response auth chứa thông tin nhạy cảm dùng Cache-Control: no-store.

Access JWT có sub và sid, không dùng role/org/permissions trong JWT để quyết định quyền. Middleware xác minh JWT, kiểm tra phiên Redis còn sống, rồi tải trạng thái user từ DB. Middleware phiên cho phép UNVERIFIED của hai role đăng ký xem thông tin của mình; middleware nghiệp vụ vẫn bắt buộc ACTIVE, membership và quyền hiện tại. Bearer vẫn được hỗ trợ cho client ngoài trình duyệt nhưng phải là access JWT có sid/phiên hợp lệ; token cũ không có sid cần đăng nhập lại. Nếu có access cookie thì cookie là nguồn xác thực được ưu tiên.

Redis chỉ lưu hash refresh token cùng metadata phiên, không chứa refresh token gốc hoặc bộ quyền. Session storage dùng namespace riêng, không dùng cache helper hoặc fallback memory. Redis lỗi làm auth trả 503; phiên hết hạn/đã thu hồi trả 401.

Session có thêm generation để hỗ trợ thu hồi tất cả phiên khi đổi/reset mật khẩu. Generation của user được giữ ở key riêng trong namespace auth và không có TTL; phiên cũ vẫn tự hết hạn theo TTL ban đầu. Login kiểm tra lại password hash trong transaction có khóa hàng để không tạo phiên mới bằng mật khẩu cũ khi có yêu cầu đổi mật khẩu đồng thời.

## Rotation, replay và đăng xuất

```text
Login hợp lệ
  → tạo sid và refresh secret ngẫu nhiên bằng crypto.randomBytes
  → ký access JWT { sub, sid }
  → ghi hash refresh token + userId + expiresAt vào Redis với NX/EXAT
  → đặt hai cookie HttpOnly

Refresh
  → kiểm tra cookie, hash và hạn phiên
  → tải lại trạng thái user; UNVERIFIED giữ quyền truy cập giới hạn
  → nếu ACTIVE, kiểm tra membership/quyền hiện tại từ DB
  → Lua so sánh hash cũ và thay bằng hash mới, giữ TTL
  → đặt cookie mới

Logout
  → xóa đúng phiên hiện tại trong Redis
  → xóa hai cookie với đúng Path/SameSite/Secure
```

Refresh token chứa sid và secret ngẫu nhiên, không phải JWT. Mỗi refresh hợp lệ đổi token; token cũ dùng lại bị xem là replay và thu hồi cả phiên đó. Mỗi lần login tạo phiên riêng; thu hồi một phiên không xóa các phiên khác hoặc key rate-limit/cache. Access token cũ còn hạn có thể hoạt động sau rotation khi cùng sid còn sống, nhưng bị từ chối sau logout/replay hoặc khi phiên hết hạn.

Frontend phải dùng một lần refresh đang chạy chung cho các request đồng thời (single-flight). Nếu nhiều request cùng gửi refresh token cũ, chỉ một request có thể thắng; việc dùng lại sẽ thu hồi phiên theo chính sách replay. Chỉ refresh khi gặp 401; 403 là lỗi trạng thái/quyền/CSRF cần xử lý tương ứng. Refresh 401/403 xóa cookie; refresh 503 giữ cookie để có thể thử lại khi dịch vụ phục hồi. Logout luôn xóa cookie; nếu Redis lỗi vẫn trả 503 vì không xác nhận được việc thu hồi phía server.

## CSRF, CORS và cách gọi từ frontend

Mọi request POST/PUT/PATCH/DELETE dưới `/api` cần header `X-CSRF-Protection: 1`. Nếu có Origin, backend yêu cầu nó khớp chính xác CLIENT_URL. Các request không có Origin như Postman/curl vẫn cần custom header. GET/HEAD/OPTIONS không yêu cầu header này. Rate limiter chung vẫn chạy trước body parser và CSRF guard.

```ts
const response = await fetch("http://localhost:5000/api/auth/login", {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Protection": "1",
  },
  body: JSON.stringify({
    identifier: "your-username-or-email",
    password: "your-password",
  }),
});

const me = await fetch("http://localhost:5000/api/auth/me", {
  credentials: "include",
});
```

Refresh/logout là POST, dùng cùng credentials/custom header, không gửi token trong body. Signup gửi body phía trên cùng custom header. Request ghi quản trị quyền cũng cần header CSRF này.

Trong Postman: bật cookie jar, gọi signup, lấy mã từ email rồi gọi POST /api/auth/email-verification/verify với body email/code, sau đó login bằng Body JSON và header X-CSRF-Protection: 1. Kiểm tra tab Cookies có hai cookie. GET /api/auth/me sẽ thấy UNVERIFIED, emailVerifiedAt và onboardingRequired=true. GET /api/schools hoặc /api/permissions vẫn trả 403. Gọi POST /api/auth/refresh để jar nhận cookie mới, rồi POST /api/auth/logout và kiểm tra /me trả 401. Muốn thử API nghiệp vụ cần tài khoản ACTIVE có membership và quyền đúng; signup không bỏ qua quy trình duyệt.

## Cấu hình và kiểm tra

```dotenv
JWT_SECRET=replace-with-a-unique-random-secret
AUTH_ACCESS_TTL_SECONDS=900
AUTH_REFRESH_TTL_SECONDS=604800
CLIENT_URL=http://localhost:3001
REDIS_URL=redis://127.0.0.1:6379/0
```

Thay JWT_SECRET bằng secret ngẫu nhiên riêng trước khi chạy. Access TTL cho phép 60–3600 giây, refresh TTL 60 giây đến 30 ngày và phải dài hơn access TTL. JWT_EXPIRES_IN cũ không còn được dùng. Real `.env` không được sửa tự động; kiểm tra NODE_ENV/CLIENT_URL theo môi trường chạy.

```bash
npm run test:auth
npm run test:email
npm run test:onboarding
npm run test:unit
npm run redis:check
npm run test:auth:redis
# Chỉ dùng PostgreSQL local test dùng một lần; Redis cũng phải là local:
MIGRATION_TEST_DATABASE_URL='<disposable-local-test-url>' npm run test:authorization
npm run validate
```

Unit/HTTP tests dùng storage được inject; runtime chỉ dùng Redis. Test Redis thật dùng prefix test riêng và chỉ dọn các key tự tạo. Test authorization dùng PostgreSQL mới trong instance local đã chọn, kiểm tra signup/login và chính sách quyền với Redis; CI dựng cả PostgreSQL và Redis tạm, không nhận credentials Azure.

Tham khảo thiết kế: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF Custom Headers](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi).
