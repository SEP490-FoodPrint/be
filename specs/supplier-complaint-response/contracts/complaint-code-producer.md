# Shared Contract: Complaint code producer và supplier consumer

**Spec**: [spec.md](../spec.md) FR-015 | **Plan**: [plan.md](../plan.md) | **API consumer**: [ingredient-quality-feedback-api.md](ingredient-quality-feedback-api.md)

## 1. Chủ sở hữu và trạng thái

Ban Giám hiệu là bên tạo khiếu nại theo yêu cầu đã chốt. Luồng tạo phía trường chịu trách nhiệm cấp/lưu mã một lần; nhà cung cấp chỉ xem và phản hồi trên cùng IngredientQualityFeedback.

Repository hiện chưa có creator HTTP/service của Ban Giám hiệu cho nghiệp vụ này. Catalog SCHOOL_MANAGEMENT_BOARD cũng chưa có default submit/view_details tương ứng. Feature supplier không tự thêm HTTP tạo đơn, mở role grants, seed hoặc xây quy trình gửi đơn; các phần đó thuộc owner phía trường. Hợp đồng này chốt shared storage/allocator và cách tích hợp, không xác nhận producer production đã có.

## 2. Định danh và định dạng

| Thuộc tính     | Hợp đồng                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------- |
| id             | UUID, PK/FK hiện có, dùng cho lookup/paths ở supplier và school detail                             |
| complaintCode  | String đã lưu, unique toàn hệ thống, bất biến sau tạo                                              |
| Prefix         | FP-CP- uppercase                                                                                   |
| Numeric suffix | Số dương BIGINT1..9223372036854775807, pad tối thiểu5chữ số                                        |
| Ví dụ          | 1→FP-CP-00001; 99999→FP-CP-99999; 100000→FP-CP-100000                                              |
| Sequence       | foodprint.ingredient_quality_feedback_complaint_code_seq, increment1, CACHE1, NO CYCLE             |
| Gaps           | Được phép khi rollback/retry; không hứa liên tục hoặc dùng lại mã đã cấp                           |
| Scope          | Một dãy toàn hệ thống, không reset theo school/supplier/năm                                        |
| Storage        | complaint_code varchar(25) NOT NULL, unique index và CHECK canonical-positive/range, không default |

Không suy ra code từ UUID, không biến code thành resource identifier để bypass scope, không cấp mã khi đọc.

## 3. Interface nội bộ và ranh giới transaction

- Shared repository method dự kiến: nextComplaintCodeSequence(tx: Prisma.TransactionClient): Promise<bigint>, chỉ gọi SQL nextval có tên sequence cố định. Repository không import DTO hoặc tự mở transaction.
- Shared pure helper dự kiến: formatComplaintCode(sequence: bigint): string; parser kiểm tra canonical/range cho output guard. Pure helper không kết nối DB/Redis và không cấp số.
- Producer service, sau khi kiểm tra quyền và phạm vi trường/delivery của mình, mở transaction tạo đơn, gọi repository lấy số, gọi pure formatter rồi chuyển code vào repository INSERT trên chính bản ghi khiếu nại. Id UUID vẫn do cơ chế hiện có cấp. Các business checks và insert dùng cùng tx.
- Không có DB code default, function hoặc trigger; writer không cung cấp code phải bị NOT NULL chặn. Không dùng MAX+1, đếm rows hoặc scope supplier để cấp số toàn hệ thống.
- Supplier list/detail/respond không gọi allocator hoặc formatter để tạo code, kể cả callback retry. Chỉ select giá trị lưu sẵn rồi map/validate. POST response không nhận complaintCode từ client và không update cột code.
- Producer chỉ trả id/complaintCode khi transaction đã commit. Khi rollback, không có complaint một phần; sequence có thể nhảy số. Nếu client mất kết nối sau commit, phải dùng cơ chế xác nhận/idempotency của luồng tạo riêng; feature này không tự thêm idempotency endpoint tạo đơn.
- Dãy cạn hoặc allocator lỗi: fail an toàn, không quay vòng/reset hoặc fallback UUID. Runtime DB role của producer cần USAGE trên sequence theo quy trình cấp quyền DB hiện hành; plan không tự thực hiện GRANT.

## 4. Legacy migration contract

Một migration mới đã review thực hiện trong transaction:

1. Khóa bảng feedback ACCESS EXCLUSIVE, chặn writer trong lúc gán mã lịch sử.
2. Thêm cột code nullable để backfill, không sửa id/delivery/lot/actor/status/response.
3. Gán số xác định theo created_at ASC/id ASC cho tất cả bản ghi hiện hữu; format không cắt số dài hơn5chữ số. Giữ created_at và updated_at chính xác; SQL tự gán updated_at bằng giá trị cũ.
4. Enforce NOT NULL, unique và CHECK canonical-positive/BIGINT range, giữ CHECK phản hồi và FK cũ.
5. Tạo sequence mới, OWNED BY cột code, setval đúng trạng thái: empty table next1; N rows nextN+1. Không setval lại ở runtime hoặc khi process khởi động.

Migration là ngoại lệ chuyển đổi dữ liệu cũ được thiết kế rõ, không phải supplier tự sinh mã khi get. Những mã mới gán lịch sử là mã gốc dùng chung từ sau migration, không được tuyên bố chúng đã được BGH tạo trong quá khứ. Sau migration tất cả bản ghi có code string bắt buộc; thiếu/sai code ở endpoint mới trả503 an toàn, không lazy fill/null/fallback.

Không sửa baseline/applied migrations, không seed/mock data trong database vận hành. Kiểm chứng migration trên database tạm có dữ liệu lịch sử và fresh empty replay trước rollout.

## 5. Rollout và compatibility gate

- Xác định tất cả writer, kể cả bên ngoài repository. Có writer cũ thì cần cửa sổ bảo trì/ngừng tạo đơn; không rolling writer thiếu code với cột NOT NULL/no default.
- Chỉ áp migration khi có authorization cho đúng target hoặc qua reviewed dev CD. Plan không thực thi DDL, deploy hoặc GRANT.
- Sau migration, kiểm tra số row/code/constraint, preserved historical values và sequence continuation. Deploy code đọc supplier tương thích và producer đã tích hợp giao diện nội bộ trước khi mở lại việc tạo đơn.
- Nếu producer BGH chưa được tích hợp, supplier có thể kiểm chứng dữ liệu migrated/fixtures nhưng không tuyên bố hành trình BGH tạo đơn thật đã hoàn tất. Không mở việc tạo đơn với writer chưa hỗ trợ code; ghi rõ trạng thái phụ thuộc trong bàn giao.
- Rollback ứng dụng không được khôi phục old writer thiếu code. Nếu cần phục hồi, giữ chế độ ngừng tạo đơn và xử lý bằng quy trình forward-fix/migration mới đã duyệt; không DROP cột, reset sequence, sửa applied migration hoặc xóa dữ liệu để quay về.

## 6. Contract verification

- Migration tests: row order/ties deterministic, empty/nonempty continuation, unchanged mọi cột cũ, required/unique/format/range, next value sau99999 không bị cắt.
- Producer contract integration: fixture gọi shared allocation/format và INSERT cùng tx để kiểm chứng nhiều trường tạo đồng thời không trùng; rollback có thể bỏ số nhưng không lưu đơn; replay/GET không cấp lại.
- Consumer: sau fixture commit, supplier list/detail/response và school detail có cùng id/code. Nhiều GET và response/retry không thay last_value/is_called của sequence hoặc code.
- Body phản hồi có complaintCode bị400; paths chỉ UUID, code thay UUID bị400; foreign UUID vẫn404.
- Fixtures chứng minh contract/storage, không chứng minh HTTP authorization/permission/default grant của creator BGH. Nghiệm thu producer thật phải ghi riêng khi owner phía trường triển khai.
