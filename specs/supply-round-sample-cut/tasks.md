# Tasks

Chi tiết ở [plan.md](plan.md).

## BE

- [x] T001 Spec-kit `specs/supply-round-sample-cut/{spec,plan,tasks}.md`.
- [x] T002 Migration enum + bảng/cột (mục 3 spec), `prisma/schema.prisma`.
- [x] T003 `lot-batch-planner.ts` + test.
- [x] T004 Số suất lẻ: `utils/portions.ts`, kitchen, meal-allocation, blockchain-proof, meal-traceability, retained-sample.
- [x] T005 Đợt 1 tạo mẻ sau khi nhận đủ hàng, cắt mẫu, phần bù, phần dư; ngày không đồ tươi.
- [x] T006 Đợt 2: nấu riêng (gộp/mẻ mới/lấy thêm/phần dư), nấu chung (gộp + mẫu khi gộp), bù đồ khô/gia vị khi chính thức.
- [x] T007 fresh-demand: chặn, phần bù, điều kiện "Đợt 2 không cần"; tạo đơn không cho sửa số lượng; dòng tách cho kho.
- [x] T008 NCC: chỉ Đợt 2 nấu riêng có `preparationStage`; `topUpLots`/`topUpReadiness`; `requiresSampleStep`.
- [x] T009 Gỡ lập mẻ thủ công (routes).
- [ ] T010 Kiểm migration trên PostgreSQL tạm (CI).

## FE

- [x] T011 NCC: stepper 3/4 bước, `SampleTopUpStep`, `SampleDispatchStep`.
- [x] T012 Kho: nút "Xác nhận lưu mẫu", chặn "Thêm Đợt 2", dòng tách trên đơn Đợt 2, nút sang Kế hoạch mẻ ở chi tiết phiếu, trang Kế hoạch mẻ đọc `?date&batchNo` và hiện phần bù/phần dư.
- [x] T013 Bếp: gỡ nút và route lập mẻ thủ công; hiển thị số suất lẻ.
- [ ] T014 `npm run build` trên máy dev (môi trường kiểm hiện tại thiếu binary rollup Linux).
