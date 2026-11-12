# Implementation Plan: Nhập danh sách lớp học từ Excel

**Branch**: `feat/017-class-excel-import` | **Spec**: [spec.md](spec.md) | **Contracts**: [contracts.md](contracts.md)

## Design

Mở rộng module `src/modules/class/`, không tạo module mới, không đổi schema, không thêm dependency backend.

- **Validation**: `importClassesSchema` bằng `z.strictObject`, giới hạn 1–300 dòng. Quy tắc nghiệp vụ theo từng dòng (độ dài tên, số suất) được kiểm tra trong service để trả lỗi theo dòng thay vì 400 cho cả file.
- **Repository**: thêm `findTeachersByUsernames` (GVCN ACTIVE của trường, không phân biệt hoa thường) và `findBusyTeachers` (giáo viên đang là GVCN hiện tại trong niên khóa). Tái dùng `findConfiguredAcademicYear`, `findNameConflicts`, `createClass`, `createAssignment`.
- **Service**: `importClasses` chạy trong `withSchoolTransaction(db, principal, "class.manage", …)`, kiểm tra role BGH, `requireWritableYear`, và `class_assignment.manage` khi có cột GVCN. Hàm thuần `evaluateImportRows` tính trạng thái từng dòng từ dữ liệu đã truy vấn (2–3 truy vấn cho cả file, không truy vấn theo từng dòng). `dryRun` trả kết quả; lưu thì 409 khi còn lỗi, nếu không thì tạo lớp và phân công tuần tự trong cùng transaction.
- **Controller/routes**: `POST /import` đăng ký cạnh `POST /copy`, trước các route `/:classId`; trả 201 khi lưu, 200 khi xem trước.

## Constitution Check

| Principle               | Result | Design                                                                                      |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------- |
| I. Layered architecture | PASS   | Validation → controller → service → repository.                                             |
| II. Tenant isolation    | PASS   | `schoolId` lấy từ principal; truy vấn giáo viên và lớp đều lọc theo `schoolId`.             |
| III. Database safety    | PASS   | Không migration, không DDL, không permission mới.                                           |
| IV. Atomicity           | PASS   | Toàn bộ lớp và phân công của một lần nhập nằm trong một transaction; còn lỗi thì không ghi. |
| V. HTTP contract        | PASS   | Giữ envelope; lớp đã tạo trả bằng `ClassItemDTO`.                                           |
| VI. Spec-driven         | PASS   | Spec, plan, tasks commit trước code trên nhánh cùng số.                                     |

## Validation strategy

`npm run validate` và `npm run test:unit`; test mới trong `tests/class-assignment.test.ts` dùng fake repository.
