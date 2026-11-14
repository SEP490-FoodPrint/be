# Kế hoạch

Dùng chung tính toán tồn kho và nhu cầu cho preview và tạo. Preview chỉ đọc, có phân quyền trường. Khi ghi, khóa và tính lại, từ chối nếu phương án thay đổi. Tạo mẻ xác nhận cùng transaction, bảo toàn lịch sử và phân quyền. Không thay đổi schema hay deploy dữ liệu.

## Constitution Check

Tuân thủ phân quyền, transaction, DTO và giới hạn dữ liệu trường; không thay đổi schema.

## Kết quả kiểm tra

- Sinh Prisma Client theo schema hiện hành, không chạy migration hoặc thay đổi dữ liệu Azure.
- Typecheck, compile BE, lint module kitchen và format các file BE thay đổi: đạt.
- Toàn bộ 421 unit tests BE đạt. Kiểm thử preview xác nhận không tạo dữ liệu, không tiêu hao kho, từ chối phiên bản cũ khi ranh giới lô đổi, tạo CONFIRMED và hoàn thành trực tiếp.
- Build FE đạt qua `node node_modules/vite/bin/vite.js build --configLoader native`. Loader thông thường gặp giới hạn quyền đọc của esbuild trên Windows.
- Phân tích cú pháp 8 file JS/JSX đã thay đổi: đạt. Bộ API test FE bị chặn tại hook Vite/esbuild; chưa coi các ca này là đạt.
- Chưa chạy thử trên trình duyệt hoặc ghi dữ liệu thật.
