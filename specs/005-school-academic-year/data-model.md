# Data Model: Năm học toàn trường

## SchoolAcademicYear → foodprint.school_academic_years

| Field Prisma | SQL                       | Quy tắc                                               |
| ------------ | ------------------------- | ----------------------------------------------------- |
| id           | uuid                      | PK, gen_random_uuid()                                 |
| schoolId     | school_id uuid            | NOT NULL, FK schools(id), RESTRICT/NO ACTION          |
| academicYear | academic_year varchar(30) | NOT NULL, nhãn không rỗng sau btrim                   |
| startDate    | start_date date           | NOT NULL, <= end_date                                 |
| endDate      | end_date date             | NOT NULL                                              |
| holidays     | holidays jsonb            | NOT NULL DEFAULT [], phải là array                    |
| createdAt    | created_at timestamptz(6) | NOT NULL DEFAULT CURRENT_TIMESTAMP                    |
| updatedAt    | updated_at timestamptz(6) | NOT NULL DEFAULT CURRENT_TIMESTAMP, Prisma @updatedAt |

Unique `(school_id, academic_year)`; một School có nhiều academicYears. Chỉ thêm relation virtual vào model School, không ALTER cột School/Class hoặc gắn FK vào WeeklyMenu.

## Holiday convention

```json
[{ "date": "2026-10-22", "reason": "Nghỉ theo kế hoạch nhà trường" }]
```

Ngày không chứa giờ/timezone; reason là lý do người cấu hình nhập. DB ở giai đoạn này chỉ kiểm tra array, không kiểm tra từng phần tử. API tương lai phải validate shape, ngày thực, lý do bắt buộc/không trắng, ngày trùng và phạm vi startDate/endDate trước khi ghi.

## Lifecycle / migration

Không thêm trạng thái, học kỳ, bộ đếm tuần, creator FK hay rule chồng khoảng chưa được xác nhận. Migration chỉ tạo bảng rỗng, index và constraints. Không tự sinh năm học/ngày nghỉ hoặc backfill từ Class.academicYear. Lớp/thực đơn/suất ăn cũ giữ nguyên.
