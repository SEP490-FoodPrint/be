# Hoàn thiện và xét duyệt hồ sơ đơn vị

Hợp đồng theo hai form Figma đã được xác nhận: [nhà trường](https://www.figma.com/design/gwGiWIuwTdzNzxiKdfG3GV/Untitled?node-id=209-574) và [nhà cung cấp](https://www.figma.com/design/gwGiWIuwTdzNzxiKdfG3GV/Untitled?node-id=209-656). Backend dùng camelCase cho JSON. Đây là API backend cho hồ sơ; bước [xác minh email bằng Resend](EMAIL_VERIFICATION.md) được mô tả riêng.

## Trạng thái

1. Signup tạo tài khoản UNVERIFIED, chưa tạo RegistrationRequest; xác minh mã email rồi login với quyền truy cập giới hạn, không phải chờ System Admin duyệt ở bước này.
2. Frontend giữ dữ liệu đang soạn. Gửi hồ sơ hợp lệ tạo RegistrationRequest PENDING, tài khoản vẫn UNVERIFIED. Chưa tạo School/Supplier/SupplierCertification.
3. System Admin duyệt: một transaction tạo tổ chức, chuyển các chứng nhận sang SupplierCertification, gắn tài khoản vào tổ chức và đổi tài khoản thành ACTIVE, hồ sơ thành APPROVED.
4. System Admin từ chối: hồ sơ REJECTED với lý do, tài khoản vẫn UNVERIFIED. Người dùng sửa và gửi lại cùng hồ sơ; backend xóa kết quả duyệt trước và chuyển lại PENDING.

Người nộp được sửa hồ sơ PENDING hoặc gửi lại hồ sơ REJECTED; cả hai giữ cùng ID và trạng thái sau ghi là PENDING. Hồ sơ APPROVED chỉ đọc, không tự kích hoạt sau khi nộp. Không nhận ID tổ chức, role, status, applicantUserId, reviewedByUserId hoặc URL tài liệu từ client. Mỗi tài khoản dùng một hồ sơ theo UNIQUE hiện có. Các phiên đang đăng nhập nhận trạng thái/quyền mới ở request kế tiếp, không cần phát JWT chứa quyền.

## Trường dữ liệu

Chỉ `name` bắt buộc cho cả hai loại. Trường tùy chọn bị bỏ qua, null hoặc chuỗi rỗng được lưu null. Chuỗi được trim; email được lowercase.

| Trường         | Nhà trường | Nhà cung cấp          | Giới hạn                |
| -------------- | ---------- | --------------------- | ----------------------- |
| name           | Bắt buộc   | Bắt buộc              | 255 ký tự               |
| code           | Tùy chọn   | Không nhận            | 80 ký tự                |
| taxCode        | Không nhận | Tùy chọn              | 80 ký tự                |
| email          | Tùy chọn   | Tùy chọn              | Email hợp lệ, 254 ký tự |
| phone          | Tùy chọn   | Tùy chọn              | 30 ký tự                |
| address        | Tùy chọn   | Tùy chọn              | 4000 ký tự              |
| certifications | Không nhận | Tùy chọn, mặc định [] | Tối đa 20 mục           |

Mỗi chứng nhận có certificationType và certificateNo bắt buộc, tối đa 120 ký tự; số chứng nhận không trùng trong một hồ sơ. issuedDate/expiryDate tùy chọn dạng YYYY-MM-DD, phải tồn tại trong lịch; khi có cả hai, expiryDate >= issuedDate. Frontend bỏ các hàng trống chưa sử dụng trước khi gửi. websiteUrl không thuộc hai form hiện tại và không được nhận ở API này.

## API tài khoản đăng ký

Các endpoint dùng cookie HttpOnly và phiên Redis như [AUTH_SESSIONS.md](AUTH_SESSIONS.md). Request POST cần `X-CSRF-Protection: 1`; trình duyệt gửi `credentials: "include"`.

| API                                            | Kết quả                                                    |
| ---------------------------------------------- | ---------------------------------------------------------- |
| GET /api/auth/onboarding                       | Hồ sơ của chính tài khoản; data=null nếu chưa nộp          |
| POST /api/auth/onboarding                      | Nộp/nộp lại; trả 201 với hồ sơ và accountStatus=UNVERIFIED |
| GET /api/auth/onboarding/documents/:documentId | URL tải tệp của chính hồ sơ, có hiệu lực 60 giây           |

Không có tệp thì gửi application/json trực tiếp:

```json
{
  "name": "Nhà cung cấp A",
  "taxCode": "0123456789",
  "certifications": [
    {
      "certificationType": "ATTP",
      "certificateNo": "ATTP-001",
      "issuedDate": "2026-01-01",
      "expiryDate": "2027-01-01"
    },
    { "certificationType": "ISO", "certificateNo": "ISO-002" }
  ]
}
```

Khi có tệp, gửi multipart/form-data với trường `profile` chứa JSON như trên. Nhà trường dùng trường file lặp `legalDocument`; nhà cung cấp dùng trường file lặp `certificate_0`, `certificate_1`, ... tương ứng index trong certifications. Mỗi nhóm được đính kèm nhiều tệp. Tổng số tối đa 20 tệp/hồ sơ, gồm tệp giữ lại và tệp mới; mọi tài liệu đều tùy chọn. Không nhận trường tệp ngoài hồ sơ hoặc ID giữ lại trùng nhau.

Mỗi lần sửa/nộp lại gửi toàn bộ trường/chứng nhận. Để giữ tệp đã lưu, gửi thêm `retainedDocuments: [{ id, field }]` từ kết quả GET (không gửi URL/publicId). `field` là `legalDocument` hoặc index `certificate_N` sau khi bỏ/sắp xếp chứng nhận. Backend chỉ nhận ID thuộc hồ sơ của chính tài khoản. Mỗi trường có thể giữ nhiều tệp và thêm tệp mới đồng thời, với tổng tối đa 20 tệp/hồ sơ. Khi thay một tệp, bỏ đúng ID đó khỏi danh sách giữ lại; các tệp khác trong nhóm không bị thay thế. Tệp không nằm trong danh sách giữ lại sẽ được dọn sau commit. Bỏ `retainedDocuments` tương đương [] để tương thích bản thay thế cũ.

Frontend gửi `expectedUpdatedAt` từ GET khi chỉnh sửa. Hồ sơ đổi phiên bản hoặc được duyệt trong khi sửa trả 409; không ghi đè. Backend kiểm tra lại ownership/trạng thái/phiên bản trong transaction sau upload, chỉ bù trừ tệp vừa tải lên nếu có xung đột. Không đổi schema/migration hoặc ghi database thật khi kiểm thử đơn vị.

```ts
const form = new FormData();
form.set("profile", JSON.stringify(profile));
form.set("certificate_0", firstCertificateFile);
await fetch("http://localhost:5000/api/auth/onboarding", {
  method: "POST",
  credentials: "include",
  headers: { "X-CSRF-Protection": "1" },
  body: form,
});
```

Trình duyệt tự đặt Content-Type cùng boundary; không đặt application/json khi gửi FormData. Đọc `/auth/me.registrationRequest.status` để phân biệt đang soạn, chờ duyệt và bị từ chối; onboardingRequired giữ true cho đến ACTIVE.

## API xét duyệt và tài liệu

| API                                                      | Điều kiện                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| GET /api/registration-requests/:id                       | SYSTEM_ADMIN có registration.view                                                                                               |
| POST /api/registration-requests/:id/approve              | SYSTEM_ADMIN có registration.approve; body {}                                                                                   |
| POST /api/registration-requests/:id/reject               | SYSTEM_ADMIN có registration.reject; body { rejectionReason } dài 1–4000 ký tự                                                  |
| GET /api/registration-requests/:id/documents/:documentId | SYSTEM_ADMIN có registration.view; hoặc tài khoản ACTIVE của đúng supplier có supplier_certification.view với hồ sơ đã APPROVED |

Quyền được đọc lại từ DB, thao tác duyệt/từ chối kiểm tra lại actor/target trong transaction Serializable. Hai lượt duyệt đồng thời chỉ tạo một tổ chức; hồ sơ không còn PENDING trả 409. Mã trường/mã số thuế trùng trả 409 và rollback toàn bộ; không tự gắn tài khoản vào tổ chức cũ. Tài khoản ACTIVE không được nộp lại hồ sơ. Lỗi validation trả 400, thiếu quyền 403, tài liệu không thuộc phạm vi 404, tệp quá lớn 413, dịch vụ không sẵn sàng 503.

`GET /api/registration-requests?page=1&limit=5` trả thông tin người đăng ký tại `data.items[i].applicantUser` với cùng các trường như API chi tiết bên dưới. Hai API dùng chung projection an toàn; thông tin lấy từ tài khoản hiện tại. Danh sách giữ hợp đồng phân trang page/limit/hasNext và chỉ trả các trường tóm tắt hồ sơ cùng applicantUser, không nhúng hồ sơ/tệp đầy đủ.

`GET /api/registration-requests/:id` trả trong `data` thông tin hồ sơ và hai object liên quan:

- `applicantUser`: `id`, `username`, `fullName`, `email`, `phone`, `status`, `emailVerifiedAt`, đọc từ tài khoản được liên kết bằng `applicantUserId`. Đây là thông tin tài khoản hiện tại, bao gồm các lần cập nhật profile cá nhân; không phải bản chụp lúc signup. `phone` và `emailVerifiedAt` có thể null; thời điểm được trả theo ISO 8601.
- `reviewedByUserId` và `reviewedByUser: { id, fullName }`: người xét duyệt, null khi chưa xét duyệt.

Tên/số điện thoại người đại diện được lưu trong users từ signup. `profileData.name/email/phone` là thông tin tổ chức, độc lập với `applicantUser.fullName/email/phone`. Tài liệu tiếp tục nằm trong `documents` với metadata an toàn. API chi tiết không trả password hash, role grants, token hoặc metadata Cloudinary nội bộ; quyền đọc vẫn yêu cầu SYSTEM_ADMIN có registration.view.

Catalog thêm registration.approve/registration.reject và quyền mặc định SYSTEM_ADMIN tương ứng cùng registration.view. Database đang dùng cần operator cập nhật catalog bằng auth:bootstrap theo chính sách môi trường; ứng dụng/CD không tự bootstrap. Không thay đổi Prisma schema, SQL migration hoặc database thật trong task triển khai API.

## Lưu tài liệu và kiểm thử

Cloudinary cần CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET trong `.env` riêng; xem `.env.example`. Không có cấu hình vẫn nộp được hồ sơ không đính kèm, còn gửi tệp trả 503. Nhận PDF/PNG/JPEG tối đa 5 MiB/tệp, kiểm tra MIME và chữ ký đầu tệp, tối đa 20 tệp/request. Các giới hạn là giới hạn API, không thay đổi yêu cầu trường bắt buộc trong Figma.

Multer nhận buffer, backend tạo public ID dưới foodprint/onboarding/<userId>/<uuid>.<format>, upload raw/authenticated, không công khai giấy tờ. RegistrationRequest giữ metadata tài liệu; response chỉ trả id, field, format, fileName, bytes. Endpoint tải xác minh scope trước khi tạo URL ngắn hạn, trả Cache-Control: no-store; không ghi URL có chữ ký tạm vào database. SupplierCertification.documentUrl dùng đường dẫn API ổn định. [Cloudinary mô tả authenticated assets và URL tải có thời hạn](https://cloudinary.com/documentation/control_access_to_media).

Nếu nộp thất bại, backend bù trừ đúng các tài liệu vừa upload; nếu nộp lại thành công, dọn tài liệu đã thay sau commit. Lỗi dọn tệp được ghi bằng documentId, không biến một lần ghi database thành công thành lỗi cho client. Cần xử lý vận hành nếu cleanup lỗi hoặc upload timeout; không xóa hàng loạt tài liệu.

`npm run test:onboarding` kiểm tra validation, chứng nhận, ownership metadata và multipart/CSRF/giới hạn tệp, không cần hạ tầng. `npm run test:authorization` kiểm thử toàn luồng, rollback, scope và concurrency trên PostgreSQL/Redis local tạm; chỉ Cloudinary được thay bằng adapter trong test, không gửi tài liệu thật. Kiểm thử upload/download với Cloudinary thật cần cấu hình môi trường riêng. Chạy thêm `npm run test:unit` và `npm run validate` trước khi tạo PR.

## Xem nhiều tệp minh chứng

API chi tiết trả mảng documents gồm id, field, format, fileName, bytes. Frontend ánh xạ mỗi mục thành một dòng tệp, ghép loại/số/ngày chứng nhận từ profileData.certifications theo certificate_N. Không cần URL công khai trong response metadata.

Khi mở tệp, gọi GET /api/registration-requests/:id/documents/:documentId với cookie phiên; API trả { url, expiresIn: 60 } sau kiểm tra quyền. URL Cloudinary có chữ ký và Content-Disposition inline để xem PDF/ảnh; frontend gọi lại API khi mở hoặc tải lại, hủy request khi đóng/đổi tệp và xử lý lỗi tại dialog. Chủ hồ sơ có endpoint GET /api/auth/onboarding/documents/:documentId.

SupplierCertification.documentUrl tiếp tục giữ đường dẫn API của tệp đầu tiên làm liên kết tới nhóm chứng nhận. Các tệp cùng field thuộc cùng chứng nhận được đọc bởi supplier hiện sở hữu chứng nhận đó với supplier_certification.view. Backend không dựa vào tổ chức hiện tại của người nộp để cấp quyền cho supplier khác. Tất cả tệp vẫn nằm trong JSON metadata hiện có; không cần đổi schema/migration.
