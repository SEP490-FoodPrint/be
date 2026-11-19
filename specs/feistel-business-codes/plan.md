# Implementation Plan: Mã nghiệp vụ FP thống nhất mã hóa bằng Feistel permutation

**Branch**: `refactor/feistel-business-codes` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: `specs/feistel-business-codes/spec.md`

## Summary

**Ánh xạ hậu tố (cốt lõi)**: với mỗi loại mã `XX`, số thứ tự thứ `s` (1…100000) lấy từ bộ đếm của loại đó được biến đổi thành hậu tố `NNNNN = pad5(feistelEncrypt(s − 1, BUSINESS_CODE_KEY))`, và mã là `FP-XX-NNNNN`. Ví dụ minh họa (giá trị thật phụ thuộc khóa): `s = 1 → FP-DE-58213`, `s = 2 → FP-DE-07741`, `s = 3 → FP-DE-93005`. Hậu tố giải ngược được về `s` bằng `feistelDecrypt` khi có khóa. Mọi loại `RG`, `DE`, `CP`, `MC`, `IC` đều đi qua đúng hàm này; không còn hậu tố là số thứ tự thô.

Thay các bộ sinh mã tuần tự riêng lẻ của hồ sơ đăng ký, chuyến giao và khiếu nại nguyên liệu bằng một cơ chế dùng chung: hàm Feistel có khóa trên miền 0–99999 (`src/utils/feistel.ts`) và allocator mã `FP-<XX>-<NNNNN>` (`src/utils/business-code.ts`) lấy số thứ tự từ bảng bộ đếm theo loại mã trong cùng transaction tạo bản ghi. Mã đã cấp giữ nguyên (Q1); allocator bỏ qua số thứ tự cho ra mã đã tồn tại hoặc `00000` và báo lỗi khi hết dải. Thêm cột mã cho hồ sơ đăng ký (`RG`, backfill mã `FP-REG-` hiện hiển thị), khiếu nại bữa ăn (`MC`) và sự cố ATTP (`IC`); hai bảng sau được backfill bằng script vận hành vì migration không được chứa khóa. Chi tiết quyết định ở [research.md](research.md), cấu trúc ở [data-model.md](data-model.md), hợp đồng ở [contracts/business-code.md](contracts/business-code.md).

## Technical Context

**Language/Version**: TypeScript strict 6.0.3; Node.js 24.22.1 theo `.nvmrc`; CommonJS, Node16 resolution.

**Primary Dependencies**: Express 4.21, Prisma/adapter-pg 7.10.1, Zod 4.6.7, `node:crypto` (HMAC-SHA256) cho Feistel. Không thêm dependency.

**Storage**: PostgreSQL schema `foodprint`. Một migration mới: bảng `business_code_counters`; cột `code` cho `registration_requests` (backfill + NOT NULL), `meal_complaints`, `food_safety_incidents` (nullable); UNIQUE + CHECK định dạng. Không đổi tên cột `delivery_no`/`complaint_code`. Redis không liên quan.

**Testing**: Node test runner + tsx. Unit mới `tests/feistel.test.ts`, `tests/business-code.test.ts` (thêm vào `test:unit`); cập nhật unit hiện có cho delivery/complaint/registration/feedback; migration test; integration đồng thời trên DB tạm qua `test:local:*`.

**Target Platform**: Backend Linux như hiện tại.

**Project Type**: Web service.

**Performance Goals**: Cấp một mã = một upsert bộ đếm + một truy vấn kiểm tra tồn tại (kỳ vọng ≈ 2,6 vòng mã hóa trong bộ nhớ). Kiểm tra trùng theo lô cho thao tác tạo nhiều mã. Không thêm truy vấn vào luồng đọc.

**Constraints**: Khóa `BUSINESS_CODE_KEY` chỉ ở cấu hình, đọc lazy, thiếu → 503. Cấp số thứ tự dưới khóa advisory theo loại mã (`pg_advisory_xact_lock`) rồi upsert bộ đếm, đúng nguyên tắc VII. Không SQL function/trigger; migration không chứa khóa. Mã bất biến. Cấp mã tuần tự hóa theo loại mã qua khóa dòng bộ đếm (chấp nhận được vì tần suất tạo bản ghi thấp). Không chạy migration/backfill khi chưa được cho phép; backfill Azure là thao tác vận hành, CD không chạy.

**Scale/Scope**: 5 loại mã (`RG`, `DE`, `CP`, `MC`, `IC`), 14 FR, 5 SC. Module chạm tới: `auth` (onboarding/session/review email), `registration`, `supplier-order`, `ingredient-quality-feedback`, `feedback`. Sự cố ATTP chưa có API list/detail nên chỉ có cột, allocator và backfill.

## Constitution Check

Đánh giá trước Phase 0 và lại sau Phase 1:

| Nguyên tắc                       | Thiết kế đáp ứng                                                                                                                                                                                                                                                                                          | Trước nghiên cứu | Sau thiết kế                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------ |
| I. Phân lớp                      | Hàm thuần trong `src/utils`; SQL bộ đếm trong hàm repository dùng chung; mỗi module cung cấp `exists` từ repository của mình; service gọi allocator và map DTO                                                                                                                                            | PASS             | PASS                                                   |
| II. Phân quyền/tổ chức           | Không đổi quyền hay scope; mã không dùng làm khóa phân quyền; tìm kiếm theo mã vẫn đi qua scope hiện có                                                                                                                                                                                                   | PASS             | PASS                                                   |
| III. An toàn DB                  | Một migration mới, không sửa migration đã áp dụng; không function/trigger; không seed (bộ đếm tự tạo bằng upsert); backfill Feistel bằng script có cho phép riêng; không đổi định danh DB đã duyệt                                                                                                        | PASS             | PASS                                                   |
| IV. Transaction/cache/rate limit | Cấp mã trong cùng transaction tạo bản ghi, `exists` dùng cùng client; rollback trả lại bộ đếm; không cache                                                                                                                                                                                                | PASS             | PASS                                                   |
| V. HTTP/safe projection          | Giữ envelope và tên trường; thêm `code` cho khiếu nại bữa ăn; lỗi 503 tiếng Việt; khóa không bao giờ xuất hiện trong phản hồi/log                                                                                                                                                                         | PASS             | PASS                                                   |
| VI. Spec-driven                  | Spec + plan cùng nhánh `refactor/feistel-business-codes`; 3 điểm làm rõ đã trả lời                                                                                                                                                                                                                        | PASS             | PASS                                                   |
| VII. Mã định danh nghiệp vụ      | Cú pháp `FP-XX-NNNNN` với hậu tố = Feistel(số thứ tự − 1), cột mã riêng cạnh `id`, UNIQUE, bất biến, Feistel có khóa + cycle-walking, cấp số dưới advisory lock theo loại mã, khóa trong cấu hình, hết dải báo lỗi; danh mục chữ viết tắt duy nhất trong `src/utils/business-code.ts` (hiến chương 2.1.1) | PASS             | PASS (xem Complexity Tracking về ngoại lệ có thời hạn) |

## Project Structure

### Documentation (this feature)

```text
specs/feistel-business-codes/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/business-code.md
├── checklists/requirements.md
└── tasks.md              # tạo bởi /speckit-tasks
```

### Source Code (repository root)

```text
src/utils/
├── feistel.ts                    # mới: hoán vị Feistel thuần
├── business-code.ts              # mới: danh mục, format/parse, allocateBusinessCodes
├── business-code.repository.ts   # mới: upsert bộ đếm theo transaction client
├── delivery-code.ts              # thu gọn: parser mã cũ
├── complaint-code.ts             # thu gọn: parser mã cũ
├── registration-id.ts            # thu gọn: parser mã cũ cho tìm kiếm
└── fp-code.ts                    # ghi chú: chỉ cho LO/CB/BG/SU, không đổi hành vi
src/config/env.ts                 # readBusinessCodeKey()
src/modules/auth/                 # onboarding.repository/service, session.service, registration-review-email
src/modules/registration/         # select/repository (tìm kiếm theo mã)/service
src/modules/supplier-order/       # service/repository: bỏ MAX-per-supplier, dùng allocator DE
src/modules/ingredient-quality-feedback/  # repository: thay nextComplaintCodeSequence
src/modules/feedback/             # repository/service/response DTO: mã MC
src/scripts/backfill-business-codes.ts    # mới: backfill MC/IC
src/types/session-user.ts         # thêm code
prisma/schema.prisma              # BusinessCodeCounter + cột code
prisma/migrations/<timestamp>_business_code_feistel/migration.sql
.env.example, .env.test.example   # BUSINESS_CODE_KEY
package.json                      # test:unit, business-codes:backfill
tests/feistel.test.ts, tests/business-code.test.ts (mới) + test hiện có cập nhật
src/modules/README.md, database/SCHEMA_BASELINE.md, README.md (biến môi trường)
```

**Structure Decision**: Giữ cấu trúc module hiện có; phần dùng chung đặt trong `src/utils` cạnh `fp-code.ts`, không tạo module HTTP mới.

## Complexity Tracking

| Violation                                                                                                      | Why Needed                                                                                                                                             | Simpler Alternative Rejected Because                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meal_complaints.code` và `food_safety_incidents.code` tạm nullable (nguyên tắc VII yêu cầu mọi bản ghi có mã) | Migration không được chứa khóa Feistel và không được dùng SQL function, nên bản ghi cũ chỉ backfill được bằng script vận hành sau khi migration deploy | Backfill tuần tự trong migration trái Q3/FR-011; NOT NULL ngay làm migration thất bại với dữ liệu cũ. NOT NULL được thêm ở migration tiếp theo sau khi backfill xác nhận trên mọi môi trường |
| Mã chuyến giao cũ trùng giữa các supplier, không có UNIQUE toàn cục                                            | Q1 giữ nguyên mã đã in/đã chứng thực blockchain                                                                                                        | Cấp lại mã làm hỏng tem QR và proof; mã mới được kiểm tra trùng toàn bảng nên vẫn duy nhất                                                                                                   |
| Hồ sơ cũ giữ chữ viết tắt 3 ký tự `FP-REG-`                                                                    | Q1/Q2: mã đã gửi qua email và hiển thị phải tra cứu được                                                                                               | Đổi sang `FP-RG-` cho hồ sơ cũ làm mất khả năng tra cứu bằng mã đã gửi                                                                                                                       |
