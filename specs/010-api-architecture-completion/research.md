# Research: API và kiến trúc hiện tại

## Phạm vi mới theo người dùng

Chỉ triển khai menu/kitchen/retained-sample cho nhân viên dinh dưỡng và bếp. Audit các module khác bên dưới chỉ để tham khảo; mọi thay đổi implementation ngoài ba module đã hoàn tác. Không tiếp tục chuẩn hóa toàn BE, auth, permission, supplier, dish, ingredient, meal hoặc module BGH. Nguồn và kết quả nghiên cứu rộng không cấp quyền sửa những module đó.

Đọc AGENTS.md, constitution, DEV_GUIDE mục 6, DEVELOPMENT_WORKFLOW bước 5 và MD API ngày 08/11/2026. Branch010 tích hợp origin/dev 8d1c000; người dùng xác nhận 7 file trước đó và patch đã lưu riêng trong Temp.

## Decisions

- Cả 27 endpoint hiện hành đã có route. Gap thực sự: lưu mẫu chưa nhận status/search, thiếu expiresAt/totalItems. Không tạo endpoint trùng hoặc CRUD chưa được yêu cầu.
- Ưu tiên spec004 duyệt nguyên tuần, catalog permission/role và UUID đã duyệt. Không đổi reservation từ UNCONFIRMED vì có thể overbook.
- Repo operation-specific nhận input nội bộ và scope, không import DTO; service giữ transaction/business/response mapping. Không facade generic nhận Prisma args.
- Zod strict schemas là nguồn Request DTO z.infer; không dùng z.unknown bọc parser cũ hoặc interface trùng schema.
- Explicit allowlist ở service cho cả nested data, serialize Date/Decimal/BigInt; không spread persistence records.
- Giữ DI factories và helper password/kitchen hoặc adapter tương thích; chú ý revoke/session và transaction order.
- 17 module list-only còn cũ sau dev merge; auth và 8 module/nhóm phức tạp cần hoàn thiện. Các module đã mới vẫn được kiểm chứng.

## Alternatives rejected

- Chuyển toàn bộ service sang repo: trộn nghiệp vụ và lưu trữ, không đạt kiến trúc.
- Tự đổi DB/enum/permission để khớp ví dụ MD: ngoài yêu cầu và xung đột nguồn approved.
- Bỏ tests hoặc giảm isolation/concurrency: mất kiểm chứng tương thích.
- Reformat toàn repo: tạo diff không cần thiết.
