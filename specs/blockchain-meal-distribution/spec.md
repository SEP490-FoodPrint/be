# Spec: Blockchain Meal Distribution

## Background & Goals

Khi nghiệp vụ phân phối suất ăn được nhân viên bếp xác nhận hoàn tất trong ngày (`confirmDistribution`), hệ thống tự động băm canonical payload của đợt phân bổ và ghi hash lên Blockchain (`FoodPrintHashRegistry.confirmHash`) như một bằng chứng kiểm chứng tính toàn vẹn off-chain.

## User Stories

- Là nhân viên bếp hoặc quản lý trường học, khi xác nhận giao suất ăn thành công trong ngày, bằng chứng phân bổ được tạo và ghi nhận ngầm lên Blockchain mà không làm gián đoạn hay rollback nghiệp vụ chính.
- Là lập trình viên / kiểm thử viên, tôi có thể xem các bằng chứng phân bổ đã ghi trên Blockchain và kích hoạt gửi lại giao dịch thử nghiệm thông qua API test.

## Functional Requirements

- FR-001: Kích hoạt ghi bằng chứng ngầm sau khi `mealAllocation.confirmDistribution` commit DB thành công.
- FR-002: Băm canonical payload chứa: `schoolId`, `date`, `mealAllocationIds`, `totalPortions`, `distributedByUserId`, `distributedAt`, `batches`. Thuật toán băm dùng `keccak256`.
- FR-003: Định danh bản ghi `recordId = id("foodprint:meal-allocation:" + date + ":" + schoolId)`.
- FR-004: Ghi nhận trạng thái vào bảng `traceability_anchors` với `anchorStatus: PREPARED -> CONFIRMED`, lưu `payloadHash`, `transactionHash`, `blockNumber`, `networkName`.
- FR-005: Endpoint dev `GET /api/dev/blockchain-distribution` để xem bằng chứng, và `POST /api/dev/blockchain-distribution/anchor` để kích hoạt ghi bằng chứng test.
- FR-006: Lỗi Blockchain (RPC lỗi, thiếu gas, timeout) không bao giờ làm rollback giao dịch nghiệp vụ trong DB PostgreSQL.
