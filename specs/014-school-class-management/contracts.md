# Contracts: Quản lý lớp học

Tất cả endpoint nằm dưới `/api/classes`, yêu cầu Bearer token, permission `class.manage` và role `SCHOOL_MANAGEMENT_BOARD`. Envelope giữ nguyên `sendSuccess` / `sendError`.

| Method | Path               | Body                                              | Thành công                                                           | Lỗi chính                                                                          |
| ------ | ------------------ | ------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| POST   | `/`                | `{ name, academicYear, registeredMealPortions? }` | 201 `ClassItemDTO`                                                   | 400 validation · 403 · 409 trùng tên / niên khóa không ghi được                    |
| POST   | `/copy`            | `{ fromAcademicYear, toAcademicYear }`            | 201 `{ toAcademicYear, created: ClassItemDTO[], skipped: string[] }` | 404 năm nguồn không có lớp ACTIVE · 409 năm đích không hợp lệ hoặc trùng năm nguồn |
| PATCH  | `/:classId`        | `{ name?, registeredMealPortions? }` (≥ 1 trường) | 200 `ClassItemDTO`                                                   | 404 · 409                                                                          |
| PATCH  | `/:classId/status` | `{ status: "ACTIVE" \| "INACTIVE" }`              | 200 `ClassItemDTO`                                                   | 404 · 409 niên khóa đã qua                                                         |

`ClassItemDTO` giữ nguyên dạng hiện có:

```json
{
  "id": "uuid",
  "schoolId": "uuid",
  "name": "1A",
  "academicYear": "2026-2027",
  "registeredMealPortions": 35,
  "status": "ACTIVE",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "homeroomTeacher": null,
  "canAssign": true
}
```
