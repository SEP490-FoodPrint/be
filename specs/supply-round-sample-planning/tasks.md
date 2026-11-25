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

- [x] T022 API `GET|PATCH /api/schools/me/sample-policy`.
- [x] T023 Quyền `school_sample_policy.manage`, `cooking_plan.view`, `cooking_plan.approve`.
- [x] T024 Repository `findSamplePolicy` có mặc định 100 g / 150 ml.
- [x] T025 Test BE cấu hình.
- [x] T026 FE trang `SCHOOL/SamplePolicy`.
- [x] T027 FE route + sidebar "Cấu hình".

## PR3 — Lập mẻ theo món + kho duyệt

- [x] T028 Module `supply-round`.
- [x] T029 Kích hoạt theo món sau khi NCC khai báo lô.
- [x] T030 Lõi lập mẻ dùng chung, lô `incoming`, pha A/B, trạng thái `PENDING_APPROVAL`.
- [x] T031 Lập mẻ thủ công trả 409 khi bữa đã có kế hoạch theo đợt.
- [x] T032 API kho xem, duyệt, thử lập lại.
- [x] T033 Chuyển `preparationStage` sau khi duyệt.
- [x] T034 Test integration trên PostgreSQL local. Đã thêm ca version cũ và cách ly trường vào `tests/authorization.integration.test.ts`. Unit test kiểm tra dữ liệu đầu vào và quyền truy cập nằm trong `tests/supply-round.test.ts`. Kết quả kiểm thử PR3 (25/11/2026): đã bổ sung migration `20261207000300_cooking_batch_lifecycle_round_statuses` mở rộng `chk_cooking_batch_lifecycle` và sửa `supplyRoundRepository.findByKey`; BE `validate` + `test:spec-gate` + `test:unit` (1001/1001 pass); FE `build` + `test:sample-policy` + `test:kitchen-nutrition` (97/97 pass) + `test:supplier-ingredient-handling` (4/4 pass); toàn bộ ca integration `T034.1–T034.4` (2 NCC khai báo đồng thời ra 1 kế hoạch, chặn lập mẻ thủ công 409, cách ly trường 404 / version cũ 409 / duyệt `ROUND1_APPROVED` + chuyển `TOP_UP_PENDING`, thiếu mẫu ghi `PLAN_FAILED` mà chuyến vẫn tạo được) đều **pass** trên DB tạm Azure (đã xóa sạch DB tạm sau khi test).
- [x] T035 FE trang kho `SCHOOL/SupplyRoundPlan`.
- [x] T036 FE nhãn trạng thái mẻ mới.

## PR4 — Lấy thêm, vận chuyển, kiểm nhận, chính thức

- [x] T037 API NCC xác nhận lấy thêm.
- [x] T038 Chặn dispatch khi chưa `READY_TO_DISPATCH`.
- [x] T039 Kiểm nhận có phần lấy thêm, chuyển mẻ sang chính thức.
- [x] T040 Bất biến số suất "lớn hơn hoặc bằng" cho mẻ theo đợt.
- [x] T041 Hoàn thành mẻ trừ cả phần mẫu.
- [x] T042 Phân bổ suất không chia phần mẫu.
- [x] T043 Đã thêm unit test cho lấy thêm sai, đúng, lặp, điều kiện dispatch, kiểm nhận, chốt mẻ, trừ kho mẫu và phân bổ. Kết quả kiểm thử integration trên DB tạm Azure (25/11/2026, đã xóa sạch DB tạm sau khi chạy): `T038.1` chặn dispatch trước khi lấy thêm (`409`); `T037` xác nhận lấy thêm `1.067 kg`, idempotent khi lặp và `409` khi lệch lượng; `T038.2` cho phép dispatch khi `READY_TO_DISPATCH`; `T039` kiểm nhận đủ `requested + sample_top_up` và chốt mẻ sang `CONFIRMED`; `T040 & T041` hoàn thành mẻ với `8/10` suất (`>=`) và trừ sạch cả phần nấu lẫn phần lưu mẫu (`availableQuantity = 0`).
- [x] T044 FE NCC: giai đoạn chuẩn bị, xác nhận lấy thêm, khóa vận chuyển.
- [x] T045 FE cột "Lưu mẫu" ở chi tiết đơn.

## PR5 — Xác nhận lưu mẫu

- [x] T046 Validation lưu mẫu không nhận lượng/đơn vị cho mẻ mới.
- [x] T047 Service ghi lượng mẫu từ mẻ.
- [x] T048 FE `KitchenSamples` chỉ đọc lượng.
- [x] T049 Test: BE `validate` + `test:unit` (1002/1002 pass, gồm ca `T049` trong `tests/sample-storage.test.ts`), FE `build` + `test:sample-policy` + `test:kitchen-nutrition` (97/97 pass), và integration PR5 trên DB tạm Azure `foodprint_pr5_test_1795556158110` (đã xóa sạch DB tạm sau khi chạy) pass toàn bộ 5 ca (`sampleQuantity` trên DTO, từ chối body có `quantity` cho mẻ theo đợt 400, lưu mẫu `< 100g` không cần nhập lượng, mẻ cũ thiếu lượng 400, mẻ cũ đủ lượng thành công).

## PR6 — Đợt 2

- [x] T050 Lập mẻ Đợt 2: phần gộp và mẻ mới.
- [x] T051 Tự bỏ qua Đợt 2 khi chốt điểm danh.
- [x] T052 `fresh-demand` trả suất thừa, nguyên liệu thiếu; chặn tạo đơn khi `NOT_NEEDED`.
- [x] T053 Kiểm tra `createOrderDraft` không nhận trường giao thêm.
- [x] T054 Test.
- [x] T055 FE bỏ "Giao thêm".
- [x] T056 FE màn Đợt 2: suất thừa, nguyên liệu thiếu, "Đợt 2 không cần đặt".

## PR7 — Giao lại

- [x] T057 Chuyến thay thế `REQUEST` với `replacesDeliveryId`.
- [x] T058 Xóa phần/mẻ khi chuyến bị từ chối.
- [x] T059 Lập lại chỉ phần/mẻ đã xóa.
- [x] T060 Test.
- [x] T061 FE NCC giao lại bằng chuyến `REQUEST`.
- [x] T062 FE trường bỏ `RE_DELIVER` và logic hủy phía FE.

## Hồi quy thực đơn, gia vị và phân bổ

- [x] T061 Kiểm tra gửi duyệt từ FE cho cả tuần và nhiều khối với đơn vị tính lặp lại, xác nhận tính nguyên tử.
- [x] T062 Kiểm tra gia vị dùng chung với mốc 32 suất và phần phát sinh 28 suất, giữ số lượng và mẫu qua lần lập lại.
- [x] T063 Kiểm tra phân bổ cho mẻ theo đợt dùng bản chụp mới và cũ, giữ kiểm tra nguồn nguyên liệu chính.
- [x] T064 Chạy lại demo FE tới bàn giao, lưu ảnh và xác minh xóa database test.
