# Plan: Blockchain Meal Distribution

## Architecture & Design

- Core utility: `src/utils/blockchain.ts` và `src/utils/canonical-hash.ts` tương tác với `FoodPrintHashRegistry.sol`.
- Service integration: Thêm async fire-and-forget hook trong `confirmDistribution` của `meal-allocation.service.ts`.
- Persistence: Ghi nhận vào bảng `traceability_anchors` bằng Prisma transaction riêng sau commit nghiệp vụ.
- Dev Route: Đăng ký router `/api/dev/blockchain-distribution` có guard `NODE_ENV === "development"`.

## Verification

- Unit/integration test với Hardhat local node.
- Chạy `npm run validate` để bảo đảm typecheck, lint, build không lỗi.
