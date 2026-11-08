# Implementation Plan: Menu, kitchen và retained-sample

**Branch**: `refactor/009-api-architecture-completion` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

## Summary and scope

Chỉ sửa `src/modules/menu/`, `src/modules/kitchen/`, `src/modules/retained-sample/`. User đã thu hẹp từ toàn BE sang phần hai role. Không sửa source module khác; các thay đổi agent ngoài scope đã hoàn tác. Dev8d1c000 và commit user57b83c1 giữ nguyên. Bổ sung retained status/search/expiresAt/totalItems và chuyển ba module sang Repository/Request DTO/Response DTO.

## Technical Context

TypeScript strict/CommonJS, Express, Prisma7, Zod4 và Node test runner hiện có; không dependency mới. Local Windows/Node22.15, chuẩn CI theo .nvmrc. Không schema/migration/DB deploy. Chỉ tests/scripts/docs tích hợp ba module được thay đổi khi cần.

## Constitution Check

| Nguyên tắc            | Trước nghiên cứu | Sau thiết kế                                                                   |
| --------------------- | ---------------- | ------------------------------------------------------------------------------ |
| I. Phân lớp           | PASS             | Chỉ 3 module: repo operation-specific, Request z.infer, Response map ở service |
| II. Quyền/tenant      | PASS             | Giữ catalog, trusted scope và recheck cùng tx                                  |
| III. Database         | PASS             | Không schema/migration/deploy/seed/reset                                       |
| IV. Transaction/cache | PASS             | Service giữ boundary, mọi repo cùng tx và isolation                            |
| V. HTTP/JSON          | PASS             | Preserve contract, bổ sung lưu mẫu, serialize rõ                               |
| VI. Spec-driven       | PASS             | Spec009 cập nhật phạm vi trước source tiếp theo                                |

## Project structure

Ba module mục tiêu có routes/controller/validation/service/repository/request.dto/response.dto. Giữ surface helper kitchen mà menu/meal modules đang dùng, phần đọc DB trong helper chuyển repo. Không tạo file giả hoặc query facade generic. Shared helpers hiện có paginationSchema/request-validation dùng nguyên trạng; không refactor utils nếu không cần.

## Research decisions

Ma trận27routes trong contracts/api-audit.md. Gap thực là GET lưu mẫu. Giữ duyệt tuần/spec004, catalog, UUID và reservation từ UNCONFIRMED. Không sửa module BGH/meal/catalog dù MD mô tả khác. Không có extension hooks. Audit rộng ban đầu chỉ là nguồn đọc; implementation ngoài scope đã hủy.

## Design

- Menu/kitchen: repo chứa queries/select/include/where/SQL locks và operation-specific persistence inputs. Service giữ tính toán, domain checks, scope và transaction, gọi repo cùng tx.
- Request DTO: z.infer từ strict schemas/type-only import; chỉ service consume. Validate giữ normalization/default/null/limits, gom lỗi tiếng Việt theo path.
- Response DTO: explicit allowlist tại service cho cả nested records; Date/Decimal/BigInt thành JSON theo hợp đồng. Không spread Prisma row, không mapper riêng.
- Retained: status enum hiện hành, search trim có giới hạn/match batchCode hoặc tên món case-insensitive. Count/list cùng WHERE/school scope; expiresAt sampledAt+24h ISO. Giữ hasNext, thêm totalItems; aliases parity.
- Complete: body empty/null giữ nguyên. preparedPortions positive integer hợp lệ nếu gửi, không quyết định trừ kho. inspectionData là JSON object legacy được tests xác nhận chấp nhận rồi bỏ qua; không suy diễn nested fields hoặc phục hồi kiểm thực bắt buộc. Top-level strict.
- Giữ các DI factories/reader/helper mà tests dùng, lỗi503 và transaction isolation. Không thay hành vi module ngoài phạm vi.

## Validation Strategy

Architecture AST test chỉ kiểm tra ba module và DTO boundary. Contract tests lưu mẫu/filter/scope/count/expiresAt/aliases; hồi quy menu/kitchen/sample/kho/approval hiện có. Lint/format file đổi, typecheck/build, test:unit. Không format toàn repo. Nếu integration cần, chỉ PostgreSQL18 disposable local; không Azure/DB thành viên. Spec gate/diff check và scope audit cuối.

## Complexity Tracking

Không ngoại lệ thiết kế. Service có thể lấy client để đặt transaction, không query trong callback. Repository chỉ query, không chứa quyết định nghiệp vụ.

## Verification results

Trước merge dev: typecheck và217unit tests PASS. Generate client sau merge PASS. Chưa kết luận baseline mới/typecheck đang chạy trong lúc source chuyển dở. Kết quả source mới cập nhật sau khi hoàn tất.
