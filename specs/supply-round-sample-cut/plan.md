# Implementation Plan: supply-round-sample-cut

Spec: [spec.md](spec.md). Lịch sử hỏi đáp và bảng luồng cuối: `.task_specs/TASK-10-v8-sample-cut-batch2-compensation.plan.md` (mục 20).

## Kiến trúc

| Phần            | File                                                                                                                                     | Nội dung                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chia mẻ         | `src/modules/kitchen/lot-batch-planner.ts`                                                                                               | `planBatchesByLots`, `distributePortions`, `splitLotByDemand` (thuần, có test)                                                                                                       |
| Số suất lẻ      | `src/utils/portions.ts` + các chỗ đọc `plannedPortions` (kitchen, meal-allocation, blockchain-proof, meal-traceability, retained-sample) | Đọc Decimal → số làm tròn 0,01; payload blockchain giữ số nguyên như cũ, số lẻ tối đa 2 chữ số                                                                                       |
| Lập mẻ theo đợt | `src/modules/supply-round/round-dish-planning.ts`                                                                                        | `planRoundDish` theo pha `ROUND1`, `ROUND1_NO_FRESH`, `ROUND2_SEPARATE`, `ROUND2_COMBINE`; `applyBatchSample` (CUT/TOP_UP/STOCK); `applyMealSeasoningSample`; `refreshCompensations` |
| Điều phối       | `src/modules/supply-round/supply-round.service.ts`                                                                                       | `afterDayProgress` (gọi sau commit nhận hàng/chốt điểm danh), `deliveryTopUpStatus`, `finalizeReceivedDay` (gộp phần Đợt 2, cắt mẫu nấu chung, bù đồ khô/gia vị từ kho)              |
| Kho dữ liệu     | `src/modules/supply-round/supply-round.repository.ts` (`roundSampleRepository`)                                                          | Lô của đợt, phần dư, phần bù, chế độ nấu, đặt lại món Đợt 2                                                                                                                          |
| Hook            | `delivery.service.ts`, `meal-attendance.service.ts`, `supplier-order.service.ts`                                                         | Gọi `afterDayProgress` sau commit; chỉ Đợt 2 nấu riêng có `preparationStage`                                                                                                         |
| Đơn Đợt 2       | `supply-order/fresh-demand.service.ts`, `supplier-onboarding.service.ts`                                                                 | Chặn khi chưa có mẻ Đợt 1; cộng phần bù; điều kiện "Đợt 2 không cần" mới; kiểm số lượng đúng lượng hệ thống tính                                                                     |
| NCC             | `supplier-order.service.ts`, `supply-order.service.ts`                                                                                   | `topUpLots` (kèm nguyên liệu, nguồn) từ lúc lập mẻ, `topUpReadiness`; `requiresSampleStep`                                                                                           |
| Bếp             | `kitchen.routes.ts`                                                                                                                      | Gỡ `GET /plan`, `POST /`                                                                                                                                                             |

## Kiểm thử

- `tests/lot-batch-planner.test.ts` (ví dụ gà xào nấm, ghép nhóm bằng nhau, lệch tỉ lệ, mẻ nhỏ, nấu chung + đồ khô, chia suất).
- Chạy lại test hiện có của supply-round, fresh-demand, supply-order-intake, supplier-onboarding, cooking-batch-groups, meal-allocation, material-allocation, blockchain-proof, meal-traceability, delivery-inspections.
- Migration `20261210000100_supply_round_sample_cut_enums`, `20261210000200_supply_round_sample_cut` cần kiểm trên PostgreSQL tạm (job migration của CI).
