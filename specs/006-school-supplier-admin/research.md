# Research: Danh sách và hồ sơ quản trị đơn vị

**Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

## 1. Endpoint và quyền riêng

**Decision**: Giữ list hiện có, thêm summary/detail và nested lists; route chọn từng tệp theo chứng nhận. Service dùng listScopes, repository AND trusted scope với selector. Summary thêm SYSTEM_ADMIN, nhóm con chỉ quyền riêng.

**Rationale**: Mỗi nhóm có permission khác nhau; detail cơ bản vẫn dùng được khi nhóm tài khoản bị cấm. Dùng scope hiện có tránh policy thứ hai.

**Alternatives considered**: Detail nhúng mọi nhóm khó phân trang/denial; role-only bypass và organizationId làm scope là sai chính sách; thêm filter mọi generic list tăng phạm vi không cần thiết.

**Evidence**: src/routes/index.ts, src/utils/resource-access.ts, src/utils/authorization.ts, docs/AUTHORIZATION.md. Đưa kiểm tra quyền list school hiện nằm trong repository về service cho đường đọc được sửa.

## 2. Total và snapshot

**Decision**: findMany/count dùng cùng where và read transaction RepeatableRead do service mở; repository nhận cùng tx. Parent check/metadata và summary cùng quy tắc.

**Rationale**: ReadCommitted có thể đọc snapshot khác nhau giữa hai SELECT. RepeatableRead đáp ứng FR-003 mà không khóa ghi hoặc duy trì snapshot qua các request. [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) mô tả bảo đảm này.

**Alternatives considered**: limit+1 chỉ đủ hasNext; Promise.all ngoài snapshot có thể lệch count/items; window count cần xử lý riêng trang vượt cuối.

**Evidence/version**: package.json khóa Prisma 7.10.1; src/generated/prisma/internal/class.ts hỗ trợ $transaction callback/isolationLevel, prismaNamespace.ts có RepeatableRead. Tài liệu Prisma hiện hành đã chuyển ORM 8 nên không áp API mới vào dự án. Chỉ đọc mã sinh để đối chiếu.

## 3. Search literal và phân trang

**Decision**: contains insensitive trên tên OR mã; trim trước max 255; escape backslash trước % và _, không unaccent; id asc. Giữ page/limit 1/20, max 100, offset <=2147483647.

**Rationale**: Giữ thứ tự cũ và quy tắc spec. [PostgreSQL Pattern Matching](https://www.postgresql.org/docs/current/functions-matching.html) xác định wildcard/escape và ILIKE; phải kiểm chứng connector thực tế.

**Alternatives considered**: Lọc JavaScript sai phạm vi; regex/full text, index/extension mới không cần và ngoài yêu cầu.

## 4. Ownership nhiều tệp

**Decision**: SupplierCertification.documentUrl là anchor nội bộ tới RegistrationRequest/documentId; chỉ hồ sơ APPROVED/SUPPLIER. readDocuments kiểm tra metadata với applicantUserId; certificate_N của anchor xác định sibling files. Batch hồ sơ theo anchor trên trang.

**Rationale**: Approval tạo chứng nhận từ profileData.certifications[index], lưu URL tệp đầu, mọi tệp vẫn trong supportingDocuments. Quyền hiện tại lấy từ supplierId của chứng nhận đã lọc scope; không lấy tổ chức hiện tại của applicant.

**Alternatives considered**: Chỉ một tệp không đủ; applicant.supplierId có thể chuyển quyền sai; URL bất kỳ/số chứng nhận không chứng minh được nhóm. Không cần schema mới.

**Evidence**: src/modules/auth/onboarding.service.ts (approval/reviewDocument); onboarding.repository.ts (findApprovedSupplierApplication/findSupplierCertificate); src/utils/onboarding-documents.ts; docs/ONBOARDING.md. Agent nghiên cứu đã đọc độc lập luồng này theo yêu cầu skill.

## 5. Metadata legacy và lỗi provider

**Decision**: Anchor/metadata thiếu, không hợp lệ, nhóm không rõ ràng → documents=[] và mở tệp 404. DB/storage lỗi → 503. Endpoint mới dùng supplier_certification.view cho SYSTEM/SUPPLIER; endpoint review cũ giữ registration.view cho SYSTEM.

**Rationale**: Không làm hỏng toàn bộ danh sách vì legacy và không tạo quyền truy cập không chứng minh được. Adapter hiện ký URL 60 giây inline; controller đặt no-store.

**Alternatives considered**: 503 cho mọi dữ liệu legacy làm danh sách không dùng được; trả documentUrl thô bỏ kiểm chứng; gọi review cũ đòi thêm quyền hồ sơ không thuộc yêu cầu chứng nhận.

**Limit**: Storage adapter chỉ ký URL, không HEAD asset. Nếu file vật lý bị xóa mà metadata còn, provider có thể báo lỗi khi mở. Không hứa backend phát hiện trước, không thêm provider call trong transaction.

## 6. Kiểm chứng

**Decision**: Unit/HTTP cho validation, mapping, lỗi, route order; integration thực kiểm chứng literal search, snapshot concurrent update, tenant/denial và file ownership. Tái sử dụng harness authorization local disposable.

**Rationale**: Mock không chứng minh được semantics SQL và cô lập snapshot. tests/authorization.integration.test.ts đã có sibling-file và applicant đổi supplier để kế thừa.

**Alternatives considered**: Framework mới, seed DB đang dùng hoặc test Azure trái phạm vi/chính sách.

Không còn quyết định cần làm rõ trước thiết kế. Prerequisite hạ tầng được ghi riêng trong quickstart.
