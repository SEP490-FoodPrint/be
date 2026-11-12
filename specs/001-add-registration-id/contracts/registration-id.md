# Contract: registrationID trong dữ liệu hồ sơ

**Spec**: [spec.md](../spec.md)  
**Data model**: [data-model.md](../data-model.md)

## Quy tắc chung

- Public field có tên chính xác `registrationID`, kiểu string, chỉ đọc.
- Giá trị: `FP-REG-` + số nguyên dương ở hệ thập phân, thêm số 0 bên trái cho đủ tối thiểu 5 chữ số. Không cắt phần số dài hơn 5 chữ số.
- Ví dụ hợp lệ: `FP-REG-00001`, `FP-REG-00010`, `FP-REG-99999`, `FP-REG-100000`.
- `id` vẫn là UUID hiện có; không đổi route params, FK, document links hoặc email outbox.
- Không xuất `registrationNumber`, bigint, sequence name hoặc giá trị bộ đếm thô.
- Mọi ngày hiện có được service chuyển sang ISO string hoặc null theo tính nullable hiện tại.
- Envelope thành công vẫn là `{ success, statusCode, message, data }`; lỗi vẫn đi qua sendError.
- Danh sách dùng query `search` để tra cứu mã hoặc tên người nộp; không đổi endpoint, quyền hoặc thứ tự danh sách. API chi tiết vẫn nhận UUID.

## Response surfaces

Các đường dẫn dưới đây dùng prefix `/api` hiện tại.

| Method / Path                           | Thành công | Vị trí bổ sung                                                       |
| --------------------------------------- | ---------- | -------------------------------------------------------------------- |
| GET /registration-requests              | 200        | `data.items[].registrationID`                                        |
| GET /registration-requests/:id          | 200        | `data.registrationID`                                                |
| GET /auth/onboarding                    | 200        | `data.registrationID`; giữ data null nếu chưa có hồ sơ               |
| POST /auth/onboarding                   | 201        | `data.registrationID`, cả lần đầu và chỉnh sửa/gửi lại thành công    |
| POST /registration-requests/:id/approve | 200        | `data.registrationID`                                                |
| POST /registration-requests/:id/reject  | 200        | `data.registrationID`                                                |
| POST /auth/login                        | 200        | `data.user.registrationRequest.registrationID` nếu summary khác null |
| POST /auth/refresh                      | 200        | `data.user.registrationRequest.registrationID` nếu summary khác null |
| GET /auth/me                            | 200        | `data.registrationRequest.registrationID` nếu summary khác null      |
| PATCH /auth/me                          | 200        | `data.registrationRequest.registrationID` nếu summary khác null      |

Không thêm mã vào response chỉ trả URL tài liệu, danh sách quyền, logout, signup hoặc kết quả không chứa hồ sơ. Không tạo hồ sơ hay cấp số trong thao tác đọc/session/profile update.

## Các hợp đồng DTO

DTO nằm trong file response riêng, chỉ service consume. Các mục dưới mô tả phần bổ sung; tất cả trường đã cho phép hiện tại được giữ nguyên.

| DTO / đối tượng                     | Trường bổ sung         | Trường giữ nguyên đáng chú ý                                                                                                                  |
| ----------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| RegistrationListItemResponseDTO     | registrationID: string | id, applicantUserId, applicantUser allowlist, requestType, status, timestamps                                                                 |
| Own onboarding / submission         | registrationID: string | id, applicantUserId, profileData đã chuẩn hóa, documents allowlist, trạng thái/mốc thời gian; submission vẫn có accountStatus                 |
| Review detail / decision            | registrationID: string | Own fields, applicantUser, reviewedByUser, reviewedByUserId, reviewVersion; decision giữ accountStatus/emailNotification và membership khi có |
| Session registrationRequest summary | registrationID: string | id, status, submittedAt ISO, rejectionReason                                                                                                  |
| SessionUser public                  | Không thêm mã ở root   | Giữ thông tin định danh/liên hệ/tổ chức, trạng thái, onboardingRequired, emailVerifiedAt; permissions chỉ theo hợp đồng ACTIVE                |

Ví dụ phần định danh trong một hồ sơ, được rút gọn để minh họa; các trường khác vẫn giữ như hợp đồng hiện hành:

```json
{
  "id": "00000000-0000-4000-8000-000000000101",
  "registrationID": "FP-REG-00001"
}
```

List pagination tiếp tục là `{ page, limit, hasNext }`, mặc định page 1, limit 20 và limit tối đa 100. Repository vẫn sắp theo UUID id tăng dần; mã trên các dòng không bắt buộc tăng theo vị trí hiển thị.

### Tìm kiếm trong danh sách

`GET /api/registration-requests?search=FP-REG-00001&page=1&limit=20` hoặc `GET /api/registration-requests?search=Nguy%E1%BB%85n` dùng chung query `search`. Kết quả khớp chính xác mã `registrationID` đầy đủ HOẶC chứa từ khóa trong tên người nộp `applicantUser.fullName`. Response public vẫn dùng tên `registrationID`.

- `search` tùy chọn, chỉ nhận một chuỗi tối đa 255 ký tự sau trim. Bỏ tham số, `search=` hoặc chuỗi trắng tương đương danh sách chưa lọc.
- Tên được tìm theo chuỗi con, không phân biệt hoa/thường nhưng vẫn phân biệt dấu; `%`, `_` và `\` là ký tự văn bản. Không tìm tên trường/nhà cung cấp, UUID, email hoặc phone.
- Parser mã chỉ nhận dạng chuẩn có phần số 1–9223372036854775807, không phân biệt hoa/thường: `FP-REG-00001`, `FP-REG-100000`, `FP-REG-9007199254740993`. Phần số không làm tròn qua Number. Chuỗi không phải mã chuẩn, kể cả mã sai hoặc vượt bigint, chỉ được tìm trong tên.
- Không có mã hoặc tên khớp trả 200 với `data.items: []` và pagination tương ứng. Lọc trước phân trang và không nhân đôi hồ sơ khớp cả mã lẫn tên.
- Search sai kiểu hoặc quá dài trả 400 với field `search`; thông báo không phản chiếu input. Tham số lạ, page/limit sai tiếp tục bị từ chối.
- Chỉ người có quyền/phạm vi danh sách hiện hành được tìm. Không lộ số bigint nội bộ hoặc đưa search vào pagination response.
- `GET /api/registration-requests/:id` và các thao tác/tài liệu tiếp tục nhận UUID. Gửi `FP-REG-00001` vào `:id` vẫn trả 400.

## Request và validation

Không thay đổi hình dạng nghiệp vụ input:

- Nộp/chỉnh sửa JSON dùng các field hồ sơ phẳng hiện tại.
- Multipart chỉ có field `profile` chứa JSON, cùng các file được chấp nhận hiện tại.
- requestType lấy từ tài khoản tin cậy; không nhận thêm requestType hoặc profileData do client gửi.
- Approve tiếp tục nhận expectedReviewVersion; reject tiếp tục nhận expectedReviewVersion và rejectionReason.
- `:id` và `:documentId` vẫn phải là UUID.

Các object schema đều strict. `registrationID` và `registrationNumber` không thuộc input allowlist; xuất hiện như field ở JSON root, multipart wrapper, JSON profile đã parse, retainedDocuments[] hoặc certifications[] phải trả 400 trước upload cloud/ghi dữ liệu. Một chuỗi văn bản thông thường có chứa chữ registrationID không phải trường tự gán mã và không bị cấm vì tên đó.

Khi chuyển validator sang Zod, giữ nguyên:

| Nhóm                  | Quy tắc hiện có cần bảo toàn                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Text                  | Trim; name ≤255, phone ≤30, address ≤4000, school code ≤80, taxCode ≤80                                                                         |
| Optional profile text | undefined, null hoặc chuỗi rỗng theo hành vi hiện tại được chuẩn hóa null                                                                       |
| Email liên hệ         | ≤254, kiểm tra dạng hợp lệ, trim và lowercase                                                                                                   |
| Certifications        | Mặc định [], tối đa 20; giữ độ dài type/no hiện tại, số chứng nhận không trùng, ngày lịch hợp lệ và expiry không sớm hơn issued                 |
| Retained documents    | Mặc định [], giới hạn tổng tệp theo MAX_PROFILE_DOCUMENTS, UUID hợp lệ, không trùng, field phù hợp loại hồ sơ; ownership kiểm tra trong service |
| expectedUpdatedAt     | Giữ cách chấp nhận chuỗi thời gian hiện tại và chuẩn hóa Date hoặc null; không siết định dạng ngoài yêu cầu                                     |
| Login                 | Identifier trim ≤320; password nguyên văn, không trim, từ 1 đến 72 byte UTF-8                                                                   |
| PATCH me              | Cần fullName hoặc phone; fullName trim ≤255; phone null/blank chuẩn hóa null, còn lại trim ≤30                                                  |

Lỗi validation tổng hợp nhiều issue có message tiếng Việt và field path, ví dụ `certifications.0.certificateNo`. Payload lỗi không chứa input thô. Nhánh typed validation error truyền `error.fields` qua sendError; không đổi các lỗi cũ hoặc cấu trúc envelope.

## Authorization và lỗi

| Trường hợp                                                   | Kết quả giữ nguyên                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Chưa xác thực/phiên không hợp lệ                             | 401 theo cơ chế hiện hành                                                             |
| Thiếu quyền view/approve/reject hoặc sai phạm vi             | 403 theo hợp đồng hiện hành                                                           |
| UUID hợp lệ nhưng không có hồ sơ/tài liệu được phép xem      | 404 theo luồng hiện hành                                                              |
| Hồ sơ stale, đã xét duyệt hoặc không còn được chỉnh sửa      | 409, giữ error.code hiện có khi được định nghĩa                                       |
| Trường mã tự gán, field lạ hoặc mã public gửi vào UUID param | 400                                                                                   |
| Ghi DB không thành công                                      | Qua cơ chế lỗi hiện hành, không có response thành công thiếu/trùng mã và không lộ SQL |

Biết mã không cấp thêm quyền. Giữ quyền registration.view, registration.approve và registration.reject tách biệt; recheck actor/target trong transaction khi ghi. Đường tài liệu supplier tiếp tục kiểm tra ownership chứng nhận hiện tại.

## reviewVersion và tính tương thích

Projection hash bao gồm đúng các trường đã được dùng trước tính năng; registrationNumber không tham gia hash vì bất biến. Việc chỉ bổ sung số không làm hash thay đổi, nhưng thay đổi hồ sơ, tài liệu hoặc liên hệ người nộp vẫn tạo version mới. Không trả bigint vào canonical JSON.

Backend mới yêu cầu migration đã có cột/default; migration tương thích với backend cũ đang bỏ qua cột mới. Frontend dùng registrationID cho phần hiển thị và tiếp tục dùng id UUID khi điều hướng hoặc gọi thao tác.
