# Implementation Plan: Kích hoạt trước hợp đồng NCC và bỏ tải trùng hồ sơ ATTP

**Branch**: `fix/supplier-contract-activation` | **Spec**: [spec.md](spec.md)

## Thay đổi

- `supplier-onboarding.rules.ts`: thêm `activationDate`. Chuyển yêu cầu `COMPLIANCE` vào nhánh miễn cấp và chỉnh câu thông báo.
- `supplier-onboarding.service.ts`: `contractDto`, `activateContract` và hành động `resume` dùng `activationDate(contract)` thay cho `schoolToday()`. `sendOrder` giữ nguyên.
- `docs/SUPPLIER_ONBOARDING.md`: cập nhật quy tắc kích hoạt và quy tắc tài liệu.
- `tests/supplier-onboarding.test.ts`: cập nhật test điều kiện hồ sơ và thêm test kích hoạt trước.

## Constitution Check

- I. Phân lớp: Pass (chỉ đổi rules và service).
- II. Scope theo principal: Pass (không đổi).
- III. Không DDL/migration: Pass.
- IV. Transaction: Pass (vẫn kiểm tra trong transaction kích hoạt hiện có).
- V. DTO: Pass (giữ nguyên hình dạng, chỉ đổi ngày xét `issues`/`eligible`).
- VI. Spec đi cùng PR: Pass.
