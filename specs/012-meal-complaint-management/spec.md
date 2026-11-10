# Meal Complaint Management

## Scope

Hoàn thiện bốn use case trên model `MealComplaint` hiện có: xem danh sách, xem chi tiết, tạo khiếu nại và phản hồi khiếu nại. Không sửa schema, không thêm attachment/chat/edit/delete/close.

## Actors and permissions

| Actor                     | Submit                  | View list/detail                          | Respond                  |
| ------------------------- | ----------------------- | ----------------------------------------- | ------------------------ |
| `HOMEROOM_TEACHER`        | `meal_complaint.submit` | `meal_complaint.view`, chỉ bản ghi tự gửi | Không                    |
| `SCHOOL_MANAGEMENT_BOARD` | Không                   | `meal_complaint.view`, trong trường       | `meal_complaint.respond` |

## Business rules

- Server lấy người gửi, người xử lý, trường và timestamp từ phiên đăng nhập.
- GVCN chỉ tạo cho `MealAllocation` thuộc lớp mình được phân công tại ngày suất ăn. Phân công lịch sử phải phủ ngày suất ăn; không dùng phân công hiện tại để suy đoán lịch sử.
- Chỉ allocation trạng thái `DISTRIBUTED` hoặc `FINALIZED` được khiếu nại.
- BGH chỉ xem và xử lý khiếu nại thuộc trường của phiên.
- GVCN chỉ xem khiếu nại do chính tài khoản gửi.
- Transition được hỗ trợ: `SUBMITTED -> IN_REVIEW`, `SUBMITTED|IN_REVIEW -> RESOLVED`.
- `RESOLVED` yêu cầu resolution; handler và resolvedAt do server ghi.
- `CLOSED` chưa có actor/điều kiện được duyệt nên không triển khai API hoặc action đóng.

## API contracts

- `GET /api/meal-complaints`: query `page`, `limit`, `status`, `complaintType`, `from`, `to`, `search`.
- `GET /api/meal-complaints/:id`: projection chi tiết an toàn, tenant/owner scoped.
- `POST /api/meal-complaints`: body strict `{ mealAllocationId, complaintType, description }`.
- `PATCH /api/meal-complaints/:id`: body strict `{ action: "START_REVIEW" }` hoặc `{ action: "RESOLVE", resolution }`.
- `GET /api/meal-portions/my-class` bổ sung projection `submission.MealAllocation { id, status }` để FE chọn allocation thật.

## Validation and authorization

- UUID hợp lệ; description 10-2000 ký tự; resolution 10-2000 ký tự.
- Date range dùng ngày ISO, `from <= to`; enum giữ nguyên Prisma.
- Mọi endpoint kiểm tra permission ở middleware và kiểm tra role/resource scope trong service/repository.
- Không nhận `schoolId`, `submittedByUserId`, `handledByUserId`, `status` từ client.

## FE-BE mapping

- Danh sách dùng GET collection; màn chi tiết dùng GET by id.
- GVCN lấy allocation qua meal-portions/my-class rồi POST complaint.
- BGH bắt đầu xử lý/hoàn tất bằng PATCH action; sau ghi FE tải lại từ server.

## Acceptance criteria and tests

- BGH không đọc/xử lý khác trường; GVCN không đọc bản ghi người khác hoặc tạo cho lớp khác.
- BGH không tạo; GVCN không phản hồi.
- Transaction rollback khi kiểm tra hoặc ghi thất bại; actor/timestamp do server cấp.
- FE có loading, empty, error, pagination/filter và responsive table/card; action đúng role.
- Lint, typecheck, build và unit tests liên quan đều pass.
