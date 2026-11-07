# Implementation Plan: Đồng bộ danh mục nguyên liệu thịt và lọc nhà cung cấp khả dụng

**Branch**: `feat/008-supplier-category-and-status` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-supplier-category-and-status/spec.md`

## Summary

Chuẩn hóa dữ liệu phân loại ngành hàng nguyên liệu từ "Thịt" thành "Thịt tươi" trong logic xử lý danh mục `categories` và bộ lọc tìm kiếm `directory`. Đồng thời, cập nhật điều kiện mặc định của bộ lọc danh bạ nhà cung cấp (`directory`) phía Ban Giám hiệu trường học: chỉ trả về các nhà cung cấp có trạng thái `ACTIVE` khi không truyền tham số `status` cụ thể, ngăn chặn các nhà cung cấp `INACTIVE` xuất hiện trong luồng liên kết.

## Technical Context

**Language/Version**: Node.js 24.22.1, TypeScript strict, CommonJS

**Primary Dependencies**: Express, Zod, Prisma 7.10.1, PostgreSQL

**Storage**: PostgreSQL qua model `Supplier` và `Ingredient` hiện có; dữ liệu lịch sử được chuẩn hóa thông qua migration/query cập nhật an toàn

**Testing**: Node test runner qua `tsx --test`, unit tests và integration tests `supplier-onboarding.test.ts`

**Target Platform**: Backend Linux container/Node.js; phát triển cục bộ trên Node.js tương thích `.nvmrc`

**Project Type**: REST API service

**Performance Goals**: Không phát sinh thêm truy vấn DB; chuẩn hóa in-memory danh mục và tối ưu index trên `Supplier.status`

**Constraints**: Tuân thủ phân quyền `supplier_relationship.manage`; giữ nguyên envelope thành công và định dạng response DTO

**Scale/Scope**: Một service module (`src/modules/supplier-onboarding/supplier-onboarding.service.ts`), bộ kiểm thử và tài liệu liên quan

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after design._

| Nguyên tắc                           | Trạng thái | Bằng chứng thiết kế                                                                                                      |
| ------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| I. Kiến trúc module phân lớp         | PASS       | Logic chuẩn hóa và điều kiện lọc đặt tại Service layer; giữ đúng giao diện đầu vào và đầu ra.                            |
| II. Phân quyền và cô lập tổ chức     | PASS       | Kiểm tra quyền `supplier_relationship.manage` qua principal tin cậy; cô lập theo trường học trong phiên.                 |
| III. An toàn cơ sở dữ liệu           | PASS       | Không thay đổi cấu trúc bảng schema; không can thiệp trái phép DDL hay reset DB; tận dụng schema PostgreSQL hiện có.     |
| IV. Transaction, cache và rate limit | PASS       | Các thao tác đọc danh bạ tuân thủ pattern đọc của hệ thống, không xung đột transaction hay vi phạm cache key.            |
| V. Hợp đồng HTTP và dữ liệu đầu ra   | PASS       | Giữ nguyên envelope thành công `sendSuccess`, mảng danh mục chuỗi và cấu trúc danh sách nhà cung cấp đã được định nghĩa. |
| VI. Phát triển theo spec             | PASS       | Nhánh và thư mục spec cùng số 008; spec/plan/tasks nằm cùng PR; không có điểm chưa rõ.                                   |

Không có vi phạm cần ghi Complexity Tracking.

## Design

### API contract

- `GET /api/supplier-onboarding/directory`
  - Query parameters:
    - `q?: string` (tên hoặc MST nhà cung cấp)
    - `category?: string` (ngành hàng, ví dụ: "Thịt tươi")
    - `provinceId?: string`
    - `status?: "ACTIVE" | "INACTIVE"` (mặc định nếu không truyền là "ACTIVE")
    - `page?: number`, `limit?: number`
  - Logic xử lý:
    - Khi `query.status` rỗng/undefined, gán mặc định `where.status = "ACTIVE"`.
    - Khi `query.category` là "Thịt tươi" hoặc "Thịt", điều kiện `where.ingredients.some.category` tìm kiếm trong mảng `["Thịt", "Thịt tươi"]`.
- `GET /api/supplier-onboarding/categories`
  - Logic xử lý:
    - Đọc các danh mục distinct từ bảng `ingredients`.
    - Thay thế bất kỳ mục nào có giá trị "Thịt" thành "Thịt tươi".
    - Loại bỏ các phần tử trùng lặp thông qua `Set`.
    - Sắp xếp kết quả theo thứ tự bảng chữ cái tiếng Việt `localeCompare(..., "vi")`.

### Layer responsibilities

- `supplier-onboarding.service.ts`:
  - Hàm `directory`: Thiết lập giá trị mặc định cho `where.status` và mở rộng khớp chuỗi danh mục thịt.
  - Hàm `categories`: Ánh xạ, khử trùng lặp và sắp xếp danh mục trả về.
