# Plan: Blockchain Traceability

## Architecture & Design

- Core utility: Tái sử dụng `src/utils/blockchain.ts`.
- Service: `src/modules/blockchain-traceability/blockchain-traceability.service.ts` truy vấn quan hệ Prisma theo chuỗi cung ứng ngược.
- Dev Route: Đăng ký router `/api/dev/blockchain-traceability` có guard `NODE_ENV === "development"`.

## Verification

- Kiểm tra kết quả truy vấn timeline chuỗi cung ứng với dữ liệu mẫu trong DB.
- Kiểm tra đối chiếu hash on-chain với Hardhat local node.
- Chạy `npm run validate`.
