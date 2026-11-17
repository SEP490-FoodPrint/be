# Neo bằng chứng hồ sơ đăng ký nhà cung cấp và nhà trường

**Feature Branch**: `feat/registration-document-proofs`

**Created**: 2026-11-17

**Status**: Draft — chờ duyệt

## Mục tiêu và phạm vi

- **UC-01 Đăng ký nhà cung cấp**: băm các giấy tờ minh chứng (giấy phép kinh doanh, chứng nhận ATTP) và xác minh chúng không bị thay đổi.
- **UC-02 Đăng ký nhà trường**: băm tài liệu minh chứng của trường và đối chiếu tài liệu đang lưu với bản đã ghi nhận.

Cơ chế dùng lại module `blockchain-proof` (UC4–UC6): version `PREPARED` được tạo trong transaction nghiệp vụ, rồi gửi ngầm lên `FoodPrintHashRegistry` sau khi commit. Thêm kind mới `registrations`.

Không làm:

- chứng nhận thêm sau khi đã duyệt (module `supplier-certification`);
- hồ sơ đã duyệt trước khi có tính năng này: không tạo version, API trả danh sách rỗng;
- frontend, sửa contract, thao tác với DB Azure.

## Clarifications

### Session 2026-11-17

- Q: Neo lúc nào? → A: Mỗi lần nộp hoặc nộp lại hồ sơ, và khi được duyệt. Từ chối không tạo version.
- Q: Giấy phép kinh doanh có cần trường riêng không? → A: Không. Đó là một loại chứng nhận (`certificationType`) trong `certifications`, tệp nằm ở `certificate_<i>`. FE không đổi.
- Q: Hồ sơ cũ thì sao? → A: Không xử lý. Không có version thì hiển thị "chưa có bằng chứng".
- Q: Chứng nhận NCC thêm sau khi duyệt? → A: Ngoài phạm vi.

## Hash tệp

Khi nộp, server tính SHA-256 trên đúng các byte nhận được (`file.buffer`) và lưu vào `supporting_documents[].sha256` (hex, 64 ký tự). Tài liệu nộp trước tính năng này không có `sha256`. `readDocuments` chấp nhận trường này nếu vắng hoặc đúng định dạng, các trường khác vẫn kiểm như cũ. API không trả `sha256` và `publicId` ra ngoài.

## Bảng `registration_request_versions`

Có cùng nhóm A, nhóm B và các cột vận hành như ba bảng version của UC4–UC6 (`BLOCKCHAIN_GLOBAL.md` mục 3.1). Nhóm C gồm `registration_request_id` và `event_type` (`SUBMITTED`, `APPROVED`).

| Version | `event_type` | `previous_version_id` | `change_reason`                         |
| ------- | ------------ | --------------------- | --------------------------------------- |
| 1       | `SUBMITTED`  | `NULL`                | `NULL`                                  |
| n > 1   | `SUBMITTED`  | version n-1           | `Nộp lại hồ sơ`                         |
| cuối    | `APPROVED`   | `SUBMITTED` cuối cùng | `Duyệt hồ sơ`; tối đa một bản mỗi hồ sơ |

Ràng buộc:

- unique `(registration_request_id, version)`;
- unique một `APPROVED` cho mỗi hồ sơ (partial index);
- unique `transaction_hash` khi khác `NULL`;
- `version = 1` ⇔ `previous_version_id IS NULL`, và `APPROVED` luôn có `previous_version_id`;
- các CHECK về hash, counter, `CONFIRMED` và `verified_at` giống các bảng UC4–UC6.

`recordId` trên chain là `keccak256("foodprint:registration_request_versions:<versionId>")`.

## Payload

`REGISTRATION_SUBMITTED`:

- các trường `v`, `type`, `registrationRequestId`, `requestType`, `applicantUserId`, `submittedAt` (ISO) và `previousHash` (hash của version liền trước hoặc `null`);
- `profile`: `profileData` như đã lưu;
- `documents`: sắp theo `field` rồi `id`, mỗi phần tử là `{id, field, fileName, format, bytes, sha256 | null}`. Không có `publicId`, nên đường dẫn lưu trữ không lên chain và không vào snapshot.

`REGISTRATION_APPROVED`:

- các trường `v`, `type`, `registrationRequestId`, `requestType`, `reviewedByUserId`, `reviewedAt`;
- `decision`: trạng thái hồ sơ, tức `APPROVED`;
- `organizationId`: `schoolId` hoặc `supplierId` của tài khoản sau khi kích hoạt;
- `submittedHash`: hash của version `SUBMITTED` đã được duyệt.

## Điểm gắn

| Nghiệp vụ     | Vị trí                                                      | Điều kiện                                                                                                       |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Nộp / nộp lại | `onboarding.service.submit`, sau khi ghi hồ sơ và xếp email | Blockchain bật, hồ sơ `PENDING`, chưa có version `APPROVED`                                                     |
| Duyệt         | `onboarding.service.approve`, sau `updateReview` và email   | Version mới nhất là `SUBMITTED` và có `submittedAt` trùng với hồ sơ (dữ liệu được duyệt đúng là dữ liệu đã neo) |

`scheduleAnchor` chạy sau khi transaction commit, dùng chung hàng đợi gửi với UC4–UC6 nên không trùng nonce. Lỗi blockchain không ảnh hưởng kết quả nộp hoặc duyệt.

## API và quyền

Dùng chung các route `/api/blockchain-proofs/:kind/...` với `kind = registrations`.

| Route                                     | Quyền                                                |
| ----------------------------------------- | ---------------------------------------------------- |
| `GET /registrations/:recordId/versions`   | `SYSTEM_ADMIN` thuộc SYSTEM + `registration.view`    |
| `POST /registrations/versions/:id/verify` | `SYSTEM_ADMIN` thuộc SYSTEM + `registration.view`    |
| `POST /registrations/versions/:id/anchor` | `SYSTEM_ADMIN` thuộc SYSTEM + `registration.approve` |

Vai trò trường có `traceability.*` vẫn nhận 403 với kind này. Không thêm permission mới.

## Xác minh

1. Kiểm tra mạng, contract và trạng thái `CONFIRMED` như UC4–UC6.
2. So hash trên chain với `data_hash`.
3. Dựng lại payload từ DB và so hash:
   - `SUBMITTED` hiện hành (bản `SUBMITTED` cuối cùng): dựng từ hồ sơ hiện tại; khác thì báo tên trường (`profile`, `documents`...);
   - `SUBMITTED` đã bị thay bởi lần nộp sau: chỉ so `snapshot` với `data_hash` và hash trên chain, vì dữ liệu và tệp cũ đã được thay thế;
   - `APPROVED`: dựng từ trạng thái duyệt và tổ chức của tài khoản.
4. Đối chiếu tệp, áp dụng cho `SUBMITTED` hiện hành và cho `APPROVED` (dùng danh sách tệp của bản `SUBMITTED` mà nó duyệt). Tải lại từng tệp trong snapshot và tính SHA-256. Kết quả `documents[]` cho mỗi tệp là một trong:
   - `MATCH`: khớp;
   - `MISMATCH`: nội dung khác;
   - `MISSING`: tệp không còn trong hồ sơ hoặc trên kho lưu trữ;
   - `NO_HASH`: nộp trước tính năng.

   Có `MISMATCH` hoặc `MISSING` thì cả bản ghi là `MISMATCH`, kèm tên tệp. `NO_HASH` chỉ ghi chú, không đổi trạng thái. Không tải được tệp vì lỗi khác thì trả `FAILED`.
