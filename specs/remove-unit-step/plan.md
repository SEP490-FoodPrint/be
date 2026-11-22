# Plan

1. `prisma/schema.prisma`: bỏ `MeasurementUnit.recommendedStep`; migration `20261129000100_drop_unit_recommended_step` xoá cột và ràng buộc.
2. `src/modules/measurement-unit`: bỏ trường khỏi validation (create/update), repository (select, create, update), DTO và mapper.
3. Test: `tests/measurement-unit.test.ts` (từ chối trường cũ), `tests/measurement-unit.integration.test.ts` (tạo/sửa không có bước). Đoạn kiểm tra migration `20261126000100_measurement_units` chạy lại migration cũ trong transaction nên giữ nguyên.
