# Kết quả kiểm chứng

- Backend: `npm run test:unit` đạt **431/431** ca, gồm các ca mới về chọn lịch theo tập khối chính xác, dị ứng theo khối, không bù suất giữa khối, lịch sử phân bổ sai khối, snapshot bữa đã lưu và nhà cung cấp trong hồ sơ duyệt.
- Backend: `npm run typecheck`, `npm run lint`, `npm run build` đạt. Build sinh Prisma Client và biên dịch TypeScript; không triển khai schema vào DB.
- `npm run validate` dừng tại `format:check`: 201 file ngoài phần thay đổi vẫn có vấn đề định dạng trong working tree. Các file thay đổi được chạy Prettier riêng. Không định dạng lại toàn repo.
- Frontend: `npm run test:kitchen-nutrition` đạt **49/49** ca. Test dùng alias và cấu hình Sass thật, không khởi động React refresh hay bundle lại cấu hình Vite.
- Frontend: build production đạt bằng `node node_modules/vite/bin/vite.js build --configLoader native` trong môi trường hiện tại.
- Không chạy migration, seed hoặc ghi dữ liệu trên Azure. Chưa kiểm tra migration trên PostgreSQL tạm, chưa test luồng trình duyệt với dữ liệu thật đã migrate. Cần triển khai migration `20261116000100_grade_specific_menus` cùng BE trước khi dùng FE mới.
