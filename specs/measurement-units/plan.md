# Kế hoạch triển khai

1. Kiểm kê read-only DB, migration/backfill danh mục/alias/unit_id, giữ cột chuỗi nghiệp vụ. Kiểm thử DB cloud tạm đã được người dùng chỉ định, chưa deploy app DB.
2. Module phân lớp, schema strict/DTO, quyền và scope danh mục global; nối resolve đơn vị vào ghi nguyên liệu/công thức và catalog quyền.
3. FE Service, trang admin/sidebar, bộ chọn đơn vị API; helper cảnh báo BigInt scale 1000, tích hợp nhập hàng và bỏ ceil/clamp làm mất số lẻ.
4. Unit/integration, validate/typecheck/build, mobile 390px, hồ sơ kiểm chứng.

## Constitution Check I–VII

I: controller-validation-service-repository, DTO riêng, CommonJS strict. II: GET danh mục global chỉ authenticate theo yêu cầu tường minh; write System Admin + permission rechecked transaction, không bypass. III: migration mới, giữ lịch sử, chỉ DB test riêng; app remote cần cho phép riêng/CD. IV: transaction Serializable và actor recheck, không cache auth. V: envelope cũ và Decimal chuỗi, DTO allowlist. VI: spec/plan/tasks trước src/prisma, nhánh feat/measurement-units. VII: đây là danh mục kỹ thuật có code chuẩn đơn vị, không phải hồ sơ/chứng từ nghiệp vụ nên không sinh FP code; không thay catalog business codes.
