# Plan: Meal Traceability

## Architecture & Module Organization

Triển khai module `src/modules/meal-traceability/` theo chuẩn 7 file:

1. `meal-traceability.routes.ts`: Đăng ký route `GET /api/meal-traceability`.
2. `meal-traceability.controller.ts`: Controller nhận HTTP query, validate, gọi service, trả response qua `sendSuccess`.
3. `meal-traceability.validation.ts`: Zod schema `z.strictObject()` xác thực query (`classId`, `date`, `mealType`, `mealAllocationId`).
4. `meal-traceability.request.dto.ts`: Type inferred từ schema validation.
5. `meal-traceability.response.dto.ts`: Output contract định nghĩa rõ các trường trả về.
6. `meal-traceability.service.ts`: Orchestration logic, gọi repository, map dữ liệu sang Response DTO và tích hợp chuỗi `blockchainProof` qua `blockchainProofService.publicMealAllocationChain`.
7. `meal-traceability.repository.ts`: Truy vấn Prisma schema hiện hành, không sửa đổi cấu trúc CSDL.

Đăng ký router vào `src/routes/index.ts`.

## Truy xuất theo khối

- Bổ sung `GET /grade` trên router hiện có. Thêm schema query chặt, kiểu yêu cầu suy ra từ Zod và DTO riêng cho phản hồi theo khối.
- Repository lấy phân bổ chưa hủy theo khối, ngày, bữa và mã trường nếu có. Service ánh xạ từng món sang DTO, gộp mẻ và lô trùng, rồi gọi `publicGradeMealChain` theo trường lấy từ kết quả truy vấn.
- Service blockchain dùng bộ truy vấn bằng chứng theo khối hiện có, ẩn lỗi gửi nội bộ và đối soát ở chế độ chỉ đọc.
- Service tổ chức mở rộng cách trình bày định lượng trong thực đơn công khai. FE dùng API truy xuất qua `TraceabilityService` từ chi tiết thực đơn công khai và màn hình nhà trường.

## Constitution Check

- I và V. Giữ các lớp hiện có. Zod xác thực query, Prisma nằm ở repository, service chọn trường đầu ra và tuần tự hóa mốc thời gian.
- II. Giữ hợp đồng đọc công khai của module. Khối xác định trường từ phân bổ và mã trường tùy chọn được đối chiếu trong truy vấn. Các API nội bộ tiếp tục dùng phạm vi của người dùng.
- III, IV và VII. Dùng schema, giới hạn truy cập API và mã nghiệp vụ hiện có. Việc truy xuất và xác minh công khai chỉ đọc.
- VI. Cập nhật cùng bộ spec, plan và tasks. Kiểm tra Spec Gate, lint, typecheck, build và các bài test liên quan trước khi đẩy nhánh.
