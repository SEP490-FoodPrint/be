# Quickstart: Kiểm chứng mã nghiệp vụ Feistel

## Điều kiện

- `npm ci`, Redis local (`docker compose up -d --no-recreate --wait redis`), PostgreSQL local đã cấu hình trong `.env` và `.env.test.local`.
- Thêm vào `.env`: `BUSINESS_CODE_KEY=<64 ký tự hex>` (tạo bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
- Áp dụng migration local chỉ khi đã được cho phép cho tác vụ này: `npm run db:migrate`.

## 1. Kiểm thử không cần hạ tầng

```bash
npx tsx --test tests/feistel.test.ts tests/business-code.test.ts
npm run test:unit
```

Kỳ vọng: toàn miền 0–99999 là hoán vị và giải ngược đúng (SC-003); 1.000 mã liên tiếp không có cặp kế tiếp có phần số liên tiếp (SC-002); thiếu khóa → 503; hết dải → 503; `00000` và mã trùng bị bỏ qua.

## 2. Migration và tích hợp trên DB tạm

```bash
npm run test:local:migrations
npm run test:local:authorization
npm run test:local:supplier-orders
```

Kỳ vọng: hồ sơ cũ có `code = FP-REG-…` đúng như trước; CHECK từ chối mã sai định dạng; 20 thao tác tạo đồng thời cùng loại cho 20 mã khác nhau (SC-001).

## 3. Kiểm tra thủ công qua API (local)

1. `npm run dev`.
2. Tạo một hồ sơ đăng ký mới → `registrationID` dạng `FP-RG-NNNNN`; hồ sơ cũ vẫn `FP-REG-…`; tìm kiếm bằng cả hai dạng trả đúng hồ sơ.
3. Supplier tạo 3 chuyến giao liên tiếp → `deliveryNo` dạng `FP-DE-NNNNN`, không liên tiếp; trang truy xuất công khai của chuyến cũ vẫn hiện mã cũ.
4. Tạo khiếu nại bữa ăn → phản hồi có `code` dạng `FP-MC-NNNNN`.
5. Xóa `BUSINESS_CODE_KEY` và khởi động lại → tạo khiếu nại bữa ăn trả 503 với thông báo tiếng Việt; các API đọc vẫn hoạt động.

## 4. Backfill bản ghi cũ

```bash
npm run business-codes:backfill
```

Kỳ vọng: in số khiếu nại bữa ăn và sự cố được gán mã; chạy lần hai gán 0 dòng. Chạy trên Azure (`-- --azure`) là thao tác vận hành riêng, cần cho phép tường minh.

## 5. Quality gate

```bash
npm run validate
npm run spec:check
```
