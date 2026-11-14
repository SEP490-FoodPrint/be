# Implementation Plan: Chặn tạo niên khóa sai định dạng hoặc đã qua

**Branch**: `feat/academic-year-create-guard` | **Spec**: [spec.md](spec.md)

## Thay đổi

- `school-academic-year.validation.ts`: thêm `academicYearLabelSchema` để kiểm tra định dạng `N-N+1`.
- `school-academic-year.service.ts`: inject `clock` và trả về 409 nếu niên khóa đã qua, trước khi mở transaction.
- `tests/school-academic-year.test.ts`: thêm test cho acceptance scenario 1–4.

## Constitution Check

- I. Phân lớp: Pass.
- II. Scope theo principal: Pass.
- III. Không DDL: Pass.
- IV. Transaction: Pass (bước kiểm tra chạy trước khi kết nối DB).
- V. DTO không đổi: Pass.
- VI. Spec đi cùng PR: Pass.
