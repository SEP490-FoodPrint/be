# Tasks: Meal Traceability

# Tasks: Meal Traceability

- [x] T001 Tạo tài liệu spec và kế hoạch theo FR-001 đến FR-007.
- [x] T002 Tạo module BE `src/modules/meal-traceability/` đầy đủ 7 file theo kiến trúc chuẩn.
- [x] T003 Đăng ký router tại `src/routes/index.ts` và kiểm tra typecheck.
- [x] T004 Xây dựng frontend service `TraceabilityService` và `mockData.js` với `blockchainProof: null`.
- [x] T005 Tích hợp nút 'Truy xuất suất ăn' và modal chọn Khối/Lớp tại `MenuDetailHeader.jsx`.
- [x] T006 Dựng giao diện `MealTraceability` tuân thủ `ai_coding_rule.md`.
- [x] T007 Kiểm thử end-to-end với biến môi trường `VITE_USE_MOCKDATA=true`.
- [x] T008 Tích hợp chuỗi bằng chứng Blockchain 5 chặng qua blockchainProofService.publicMealAllocationChain.

## Kết quả kiểm tra

- BE: Đã tạo module đầy đủ 7 file theo kiến trúc chuẩn Spec-Driven, không thay đổi schema Prisma. Typecheck TypeScript nội bộ module đạt 100%.
- FE: Đã tạo `TraceabilityService` kèm mock data chuẩn 100% schema và `blockchainProof: null`. Build Vite production đạt thành công (`✓ built in 30.63s`).
- Tích hợp MenuDetail: Nút 'Truy xuất suất ăn' kích hoạt popup chọn Khối & Lớp, chuyển trang mượt mà.
