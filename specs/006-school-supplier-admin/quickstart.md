# Quickstart: Kiểm chứng quản trị trường và nhà cung cấp

Đây là hướng dẫn chạy sau khi triển khai, không phải báo cáo các kiểm thử đã chạy trong giai đoạn lập kế hoạch.

## Prerequisites

- Node/npm đúng .nvmrc/engines, npm ci, .env riêng có JWT/session config theo README; không commit thông tin đăng nhập.
- Prisma Client hiện có hoặc npm run prisma:generate; không cần migration mới cho feature.
- API runtime cần PostgreSQL local và Redis theo README. GET health chỉ xác nhận process.
- Integration chỉ chạy với MIGRATION_TEST_DATABASE_URL trỏ PostgreSQL local disposable được operator chọn rõ ràng; harness tạo DB mới. Không dùng database thành viên/Azure, không reset/import/seed.
- Tài khoản ACTIVE có quyền đúng theo [hợp đồng](contracts/admin-directory.md); các bản ghi thử do harness tạo trong DB tạm, không bootstrap/seed database đang dùng.
- Storage adapter giả lập trong integration. Kiểm chứng provider thật chỉ dùng tài liệu hiện có và cấu hình Cloudinary riêng; không upload/gửi email trong kiểm thử feature.

## Lệnh kiểm chứng sau triển khai

Chạy từ repository root:

```bash
npm run prisma:validate
npm run typecheck
npm run build
npm run validate
npm run test:unit
```

tests/school-supplier-admin.test.ts phải được thêm vào test:unit khi triển khai. Chạy riêng để điều tra lỗi:

```bash
npx tsx --test tests/school-supplier-admin.test.ts
```

Khi operator đã thiết lập MIGRATION_TEST_DATABASE_URL local disposable và Redis theo harness:

```bash
npm run test:authorization
```

Không điền URL mẫu làm target thật. Nếu thiếu hạ tầng, ghi kiểm thử bị chặn và prerequisite thiếu; unit pass không thay kết quả integration.

Runtime local theo README:

```bash
docker compose up -d --no-recreate --wait redis
npm run db:check
npm run redis:check
npm run dev
```

Không xóa volume/orphan hoặc flush Redis. Các lệnh trên dành cho validation, không cấp phép thay đổi schema/data.

## Kiểm chứng HTTP

Dùng cookie jar từ luồng login hiện hành của tài khoản thử; không đưa mật khẩu/token vào command history. Các biến ID dưới đây là ID thật từ dữ liệu thử. FOODPRINT_COOKIE_JAR là đường dẫn cookie jar riêng, không commit.

```bash
curl --fail-with-body -b "$FOODPRINT_COOKIE_JAR" --get "$FOODPRINT_API_BASE/schools" --data-urlencode "page=1" --data-urlencode "limit=5" --data-urlencode "search=Hoa" --data-urlencode "status=ACTIVE"
curl --fail-with-body -b "$FOODPRINT_COOKIE_JAR" "$FOODPRINT_API_BASE/schools/summary"
curl --fail-with-body -b "$FOODPRINT_COOKIE_JAR" "$FOODPRINT_API_BASE/schools/$FOODPRINT_SCHOOL_ID"
curl --fail-with-body -b "$FOODPRINT_COOKIE_JAR" "$FOODPRINT_API_BASE/schools/$FOODPRINT_SCHOOL_ID/classes?limit=5"
curl --fail-with-body -b "$FOODPRINT_COOKIE_JAR" "$FOODPRINT_API_BASE/schools/$FOODPRINT_SCHOOL_ID/suppliers?limit=5"
curl --fail-with-body -b "$FOODPRINT_COOKIE_JAR" "$FOODPRINT_API_BASE/schools/$FOODPRINT_SCHOOL_ID/accounts?limit=5"
curl --fail-with-body -b "$FOODPRINT_COOKIE_JAR" "$FOODPRINT_API_BASE/suppliers?limit=5&status=INACTIVE"
curl --fail-with-body -b "$FOODPRINT_COOKIE_JAR" "$FOODPRINT_API_BASE/suppliers/summary"
curl --fail-with-body -b "$FOODPRINT_COOKIE_JAR" "$FOODPRINT_API_BASE/suppliers/$FOODPRINT_SUPPLIER_ID"
curl --fail-with-body -b "$FOODPRINT_COOKIE_JAR" "$FOODPRINT_API_BASE/suppliers/$FOODPRINT_SUPPLIER_ID/certifications?limit=5"
curl --include --fail-with-body -b "$FOODPRINT_COOKIE_JAR" "$FOODPRINT_API_BASE/supplier-certifications/$FOODPRINT_CERTIFICATION_ID/documents/$FOODPRINT_DOCUMENT_ID"
```

FOODPRINT_API_BASE ví dụ http://localhost:3000/api, dùng port thực trong .env. Không chia sẻ output chứa URL ký số; thời hạn 60 giây/no-store phải có ở endpoint tệp.

## Ma trận kết quả bắt buộc

| Mục tiêu           | Cách kiểm chứng                                                                               | Kết quả mong đợi                                                               |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| SC-001, FR-001–003 | Harness 100 school/supplier, mục khớp ngoài 5 dòng đầu; case/dấu/%/_/backslash và AND status  | Không thiếu bản ghi khớp/không có bản ghi sai; ký tự wildcard là literal       |
| SC-002, FR-004–006 | Duyệt limit 5 và 20; 12 kết quả ở limit 5; no-match và trang vượt cuối                        | 5/5/2; total=12; hasNext true/true/false; không trùng/thiếu                    |
| FR-003 snapshot    | Integration đồng bộ hai connection, commit cập nhật giữa count và items                       | Một response cùng snapshot; response sau thấy cập nhật                         |
| SC-003, FR-007–008 | 100 bản ghi/85 ACTIVE; thay bộ lọc list; thử summary với school admin                         | Summary 100/85; không đổi theo list; không đủ role/quyền 403                   |
| SC-004, FR-009–014 | Mở trực tiếp INACTIVE; ba nhóm trường, trường trống, lịch sử UNLINKED                         | Đủ projection, null giữ nguyên, nhóm trống total=0; không phải dùng public API |
| SC-005, FR-019–023 | System thiếu quyền; denial SCHOOL; trường B; supplier khác; tài khoản inactive                | 401/403/404 đúng hợp đồng; không lộ count/metadata/liên kết                    |
| SC-006, FR-015–018 | Chứng nhận nhiều sibling files, file khác nhóm cùng hồ sơ, applicant đổi supplier             | Chọn từng sibling hợp lệ được; sai nhóm 404; ownership theo chứng nhận         |
| Legacy và lỗi      | Anchor null/sai/URL ngoài, duplicate metadata, hồ sơ chưa APPROVED/sai loại; DB/storage throw | documents=[]/404 cho dữ liệu không khả dụng; hạ tầng 503 không lộ secret       |
| Validation         | Query lặp, unknown key, sortBy, status sai, offset lớn, UUID sai; nhiều lỗi cùng lúc          | 400, field paths, thông báo tiếng Việt không phản chiếu raw value              |
| Tương thích        | Generic lists, public ACTIVE-only, /public/locations, /me/cooking-mode và /summary            | Routes không bị /:id bắt nhầm; query/envelope/projection cũ được giữ           |

Bổ sung regression System chỉ có supplier_certification.view mở được tệp endpoint mới nhưng không được review hồ sơ; chỉ registration.view không được mở endpoint chứng nhận. Unit/HTTP xác minh allowlist, serialization, mapping lỗi và no-store; storage fake kiểm tra không được gọi trước khi quyền/nhóm được xác minh.

## Báo cáo kết quả

Ghi lệnh đã chạy, PASS/FAIL, prerequisite bị thiếu, phiên bản runtime và target local đã chọn bằng tên không chứa credential. Không ghi URL DB, cookie hoặc URL ký số. Nghiên cứu/plan không được tính là đã triển khai hoặc đã chạy các test feature.

## Implementation run — 2026-11-07

Node v24.22.1/npm 11.19.1 available; locked dependencies and generated client present. Existing ignores verified; Docker ignore added. Integration target must be explicitly selected; no database changes executed during setup.

### Kết quả thực thi hiện tại

- Unit: npm run test:unit PASS 207/207, không skip. Bao gồm bốn tệp directory mới, validation/transaction và regression generic lists.
- npm run test:authorization BLOCKED: harness từ chối vì MIGRATION_TEST_DATABASE_URL chưa được đặt; chưa kết nối hoặc thay đổi database. Các kịch bản directory đã bổ sung nhưng chưa được xác minh trên PostgreSQL thật.
- Chưa chạy smoke HTTP trên dữ liệu thật hoặc provider Cloudinary thật; không có seed/migration/schema change.

- Quality: npm run validate PASS (lint, format, typecheck, build); npm run prisma:validate PASS. Typecheck sau khi bổ sung integration scenarios PASS; scoped lint được chạy lại.
