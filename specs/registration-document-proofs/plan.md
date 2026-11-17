# Kế hoạch

## Thay đổi

| Phần       | File                                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration  | `prisma/migrations/20261121000100_registration_request_versions/migration.sql`                                                                                        |
| Schema     | `prisma/schema.prisma`: enum `RegistrationProofEventType`, model `RegistrationRequestVersion`, back-relation ở `RegistrationRequest`, `User`                          |
| Hash tệp   | `src/utils/onboarding-documents.ts` (`sha256?`, `documentSha256`), `onboarding.repository.ts` (`submissionData` giữ `sha256`)                                         |
| Payload    | `blockchain-proof.payload.ts`: `buildRegistrationSubmittedPayload`, `buildRegistrationApprovedPayload`                                                                |
| Repository | `blockchain-proof.repository.ts`: kind `registrations`, `readRegistration`, `latestRegistrationVersion`, `createRegistrationVersion`                                  |
| Service    | `blockchain-proof.service.ts`: `prepareRegistrationSubmitted`, `prepareRegistrationApproved`, `proofScope`, `checkDocuments`, `withDocuments`, tham số `readDocument` |
| Route      | `blockchain-proof.routes.ts`: chọn quyền theo `kind`; `validation.ts`, `response.dto.ts`                                                                              |
| Điểm gắn   | `onboarding.service.ts`: tham số thứ ba `proofs` của `createOnboardingService`                                                                                        |
| Test       | `tests/registration-proof.test.ts`, `tests/onboarding.test.ts`                                                                                                        |

## Quyết định

- Không thêm cột vào `registration_requests`. Hash tệp nằm trong `supporting_documents` JSON, cạnh metadata đã có.
- SHA-256 được tính trong service, trên đúng buffer đã upload. Không phụ thuộc giá trị Cloudinary trả về, và fake storage trong test vẫn có hash.
- Tải tệp khi xác minh dùng URL có chữ ký 60 giây của `documentStorage.download` cùng `fetch` với timeout 30 giây. Test thay bằng `readDocument`.
- Không có quyền mới. Hồ sơ đăng ký đã do `SYSTEM_ADMIN` xét duyệt với `registration.*`.
- Version `APPROVED` chỉ được tạo khi `submittedAt` trong snapshot trùng với hồ sơ. Nếu lần nộp cuối diễn ra lúc blockchain tắt, bản duyệt không bị gắn nhầm vào lần nộp cũ.

## Rủi ro

- Hồ sơ cũ không có version nào. Tài liệu được giữ lại từ trước tính năng không có hash và hiện `NO_HASH`.
- Trong transaction nộp hoặc duyệt, `prepare*` chỉ đọc và ghi DB. Nếu nó lỗi thì nghiệp vụ rollback, giống UC4–UC6.
