# Tasks

Chi tiết từng task ở [plan.md](plan.md). Mỗi PR đánh dấu xong khi đã gộp vào `dev`.

## PR1 — Nền tảng

- [x] T001 Spec-kit `specs/supply-round-sample-planning/{spec,plan,tasks}.md`.
- [x] T002 `npm run test:spec-gate`.
- [x] T003 Bảng `school_sample_policies`.
- [x] T004 Bảng `supply_rounds`.
- [x] T005 Bảng `supply_round_dish_plans`.
- [x] T006 `cooking_batches.supply_batch_no`, `cooking_batch_groups.supply_round_id`.
- [x] T007 `cooking_batch_dishes.sample_quantity`, `sample_ratio`, `sample_unit`, `standard_quantity_snapshot`.
- [x] T008 `cooking_batch_lots.sample_quantity` + đổi CHECK `quantity_used`.
- [x] T009 `menu_meal_seasoning_lots.sample_quantity`.
- [x] T010 Bảng `cooking_batch_round_parts`, `cooking_batch_round_part_lots`.
- [x] T011 `deliveries.preparation_stage`, `replaces_delivery_id`, `top_up_confirmed_*`.
- [x] T012 Partial unique mới thay `uq_deliveries_request_mode`.
- [x] T013 `sample_top_up_quantity` cho `ingredient_lots`, `delivery_items`, `supply_request_items`.
- [x] T014 `prisma/schema.prisma`.
- [x] T015 `prisma:validate`, `prisma:generate`, `typecheck`. Migration đã kiểm trên một database tạm mới tạo trên server Azure (được người dùng cho phép, 24/11/2026): `migrate deploy` toàn bộ, `migrate diff` không lệch, kiểm catalog và CHECK `supply_rounds`, rồi xóa database tạm. Subtest mới trong `tests/migrations.test.ts` sẽ chạy ở job migration của CI (PostgreSQL tạm).
- [x] T016 `sampleRatio` (làm tròn đơn vị đếm, D10).
- [x] T017 `sampleLines`, `sampleNeedInLotUnit` (hao hụt MAIN, gia vị 0, làm tròn lên 3 chữ số, D11, D12, N2).
- [x] T018 `assignSampleLots` (thứ tự ưu tiên gán lô, spec 7.3).
- [x] T019 `seasoningSampleNeeds` (phần mẫu gia vị theo bữa, D13).
- [x] T020 `sourceKey`, `splitRound2` (gộp Đợt 2, spec 8.2).
- [x] T021 `batch2Decision` (D30, spec 8.1).

## PR2 — Cấu hình lưu mẫu

- [ ] T022 API `GET|PATCH /api/schools/me/sample-policy`.
- [ ] T023 Quyền `school_sample_policy.manage`, `cooking_plan.view`, `cooking_plan.approve`.
- [ ] T024 Repository `findSamplePolicy` có mặc định 100 g / 150 ml.
- [ ] T025 Test BE cấu hình.
- [ ] T026 FE trang `SCHOOL/SamplePolicy`.
- [ ] T027 FE route + sidebar "Cấu hình".

## PR3 — Lập mẻ theo món + kho duyệt

- [ ] T028 Module `supply-round`.
- [ ] T029 Kích hoạt theo món sau khi NCC khai báo lô.
- [ ] T030 Lõi lập mẻ dùng chung, lô `incoming`, pha A/B, trạng thái `PENDING_APPROVAL`.
- [ ] T031 Lập mẻ thủ công trả 409 khi bữa đã có kế hoạch theo đợt.
- [ ] T032 API kho xem, duyệt, thử lập lại.
- [ ] T033 Chuyển `preparationStage` sau khi duyệt.
- [ ] T034 Test integration.
- [ ] T035 FE trang kho `SCHOOL/SupplyRoundPlan`.
- [ ] T036 FE nhãn trạng thái mẻ mới.

## PR4 — Lấy thêm, vận chuyển, kiểm nhận, chính thức

- [ ] T037 API NCC xác nhận lấy thêm.
- [ ] T038 Chặn dispatch khi chưa `READY_TO_DISPATCH`.
- [ ] T039 Kiểm nhận có phần lấy thêm, chuyển mẻ sang chính thức.
- [ ] T040 Bất biến số suất "lớn hơn hoặc bằng" cho mẻ theo đợt.
- [ ] T041 Hoàn thành mẻ trừ cả phần mẫu.
- [ ] T042 Phân bổ suất không chia phần mẫu.
- [ ] T043 Test.
- [ ] T044 FE NCC: giai đoạn chuẩn bị, xác nhận lấy thêm, khóa vận chuyển.
- [ ] T045 FE cột "Lưu mẫu" ở chi tiết đơn.

## PR5 — Xác nhận lưu mẫu

- [ ] T046 Validation lưu mẫu không nhận lượng/đơn vị cho mẻ mới.
- [ ] T047 Service ghi lượng mẫu từ mẻ.
- [ ] T048 FE `KitchenSamples` chỉ đọc lượng.
- [ ] T049 Test.

## PR6 — Đợt 2

- [ ] T050 Lập mẻ Đợt 2: phần gộp và mẻ mới.
- [ ] T051 Tự bỏ qua Đợt 2 khi chốt điểm danh.
- [ ] T052 `fresh-demand` trả suất thừa, nguyên liệu thiếu; chặn tạo đơn khi `NOT_NEEDED`.
- [ ] T053 Kiểm tra `createOrderDraft` không nhận trường giao thêm.
- [ ] T054 Test.
- [ ] T055 FE bỏ "Giao thêm".
- [ ] T056 FE màn Đợt 2: suất thừa, nguyên liệu thiếu, "Đợt 2 không cần đặt".

## PR7 — Giao lại

- [ ] T057 Chuyến thay thế `REQUEST` với `replacesDeliveryId`.
- [ ] T058 Xóa phần/mẻ khi chuyến bị từ chối.
- [ ] T059 Lập lại chỉ phần/mẻ đã xóa.
- [ ] T060 Test.
- [ ] T061 FE NCC giao lại bằng chuyến `REQUEST`.
- [ ] T062 FE trường bỏ `RE_DELIVER` và logic hủy phía FE.
