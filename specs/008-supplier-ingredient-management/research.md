# Research: Supplier Ingredient Management

## Quyền quản trị và đọc

**Decision**: Nhóm /api/ingredients/management yêu cầu đúng INGREDIENT_SUPPLIER_ADMIN + ingredient.manage + supplier hiện tại ACTIVE. Giữ GET /api/ingredients cho quyền đọc hiện có. Helper quản trị mới ở resource-access trả scope tin cậy; repository áp supplierId trong WHERE. Danh mục dùng chung chỉ đọc sau khi xác minh supplier của actor, không tạo ownership giả.

**Rationale**: listScopes.ingredient hiện hỗ trợ nhiều tổ chức, permission OR; tests/authorization.integration.test.ts có kịch bản staff được cấp ingredient.view đọc danh sách cũ. FR-005 yêu cầu giữ hành vi này.

**Alternatives considered**: Siết GET cũ sẽ phá quyền đọc; chỉ permission không ngăn staff được gán manage.

## Transaction và lỗi

**Decision**: Service sử dụng authorizationTransaction trong src/utils/authorization.ts (Serializable, tối đa ba lần thử khi conflict). Repository nhận tx, nạp actor qua loadPrincipal(id, tx), đọc supplier và target; service xác minh actor vẫn cùng supplier, đúng role/quyền, supplier ACTIVE. Repository khóa supplier rồi target theo id + supplierId theo thứ tự ổn định khi cần tuần tự hóa ghi. Không dùng withSchoolTransaction cho supplier.

**Rationale**: Chưa có helper supplier; mọi đọc recheck và ghi cần chung transaction. Unique constraint bảo vệ tranh chấp tên. Không tuyên bố khóa supplier tự khóa mọi thay đổi permission; kiểm thử với luồng thu hồi quyền hiện có.

**Alternatives considered**: Transaction mỗi repository không nguyên tử; query trong service trái phân lớp; precheck tên không đủ chống race.

**Error handling**: Chuyển P2002 thành 409, FK category không còn hợp lệ thành 400 bên trong callback/repository adapter. databaseOperation hiện chuyển lỗi không phải HttpError thành 503; hết retry trả 503 an toàn, không lộ SQL.

## Ảnh

**Decision**: coverImage nullable string lưu TEXT, imageDescription string[] lưu TEXT[]. Nhận HTTP/HTTPS URL tuyệt đối không credentials hoặc đường dẫn bắt đầu một /; không //, backslash, control characters, chuỗi rỗng hoặc scheme khác. Mỗi tham chiếu trim và tối đa 2048 ký tự. Không fetch ảnh. Giới hạn body JSON hiện có 100 KiB; không đặt max số ảnh nghiệp vụ mới.

**Rationale**: Spec dùng tham chiếu có sẵn, không xây upload. TEXT[] giữ thứ tự và kiểu chuỗi, không cần bảng ảnh.

**Alternatives considered**: JSONB không cần thiết; upload Cloudinary dù có dependency vẫn mở rộng phạm vi.

## Danh mục và migration

**Decision**: Prisma IngredientCategory ánh xạ foodprint.ingredient_categories, đúng ba cột; categoryId nullable, FK Restrict. Backfill DISTINCT category cũ không chỉ khoảng trắng, giữ nguyên chuỗi có ý nghĩa kể cả khoảng trắng bao quanh; null/blank thành chưa phân loại. Không đặt unique tên category mới.

**Rationale**: Naming theo repo; VARCHAR(120) theo cột cũ. Giữ nguyên tên bảo toàn bộ lọc chuỗi hiện hành. Đây là chuyển dữ liệu thật, không seed.

**Alternatives considered**: Trim/lowercase có thể gộp giá trị khác nhau; drop trước backfill mất dữ liệu; giữ hai cột phân loại tạo hai nguồn sự thật.

## Consumer và ẩn

**Decision**: Thay category trong ingredient.service.ts; menu/menu.service.ts tại main/seasoning options và menu detail; supplier-onboarding/supplier-onboarding.service.ts tại contract projection, supplier category filter, distinct category lists và chi tiết trả ingredients. Sửa fixture tests/supplier-onboarding.integration.test.ts. Legacy output category vẫn string/null từ categoryName; legacy filter so tên chính xác. distinct category chuyển sang categoryId rồi map tên; danh sách tên cũ vẫn dựa trên ingredients ACTIVE.

**Rationale**: Các consumer mất compile nếu chỉ đổi schema. Main/seasoning options và supplier discovery đã lọc ACTIVE, phải giữ; menu/contract history không lọc ACTIVE, cần đọc được sau ẩn.

**Alternatives considered**: Đổi mọi output sang object gây breaking change; filter INACTIVE toàn cục mất lịch sử.

## Gate và kiểm chứng

**Decision**: Đồng bộ nhánh từ feat/002-add-ingredients-for-supplier thành feat/008-supplier-ingredient-management. Dùng harness migration/authorization disposable local qua MIGRATION_TEST_DATABASE_URL; sinh tasks ở bước tiếp theo.

**Rationale**: .github/scripts/spec-gate.mjs yêu cầu số nhánh khớp spec và đủ spec/plan/tasks. Setup-plan trả BRANCH theo feature resolver, nên xác nhận nhánh thật bằng git branch --show-current.

**Alternatives considered**: Giữ nhánh 002 với spec 008 bị CI chặn; test trên DB thành viên hoặc Azure vi phạm chính sách.

Các quyết định đã được giải quyết bằng khảo sát repository, không thay phiên bản thư viện hay thêm tích hợp bên ngoài.
