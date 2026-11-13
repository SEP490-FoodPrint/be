# Kết quả kiểm chứng bản sửa CD

## Phạm vi và nguyên nhân

Nhánh `fix/023-migration-cd-history`, worktree `/tmp/foodprint-migration-cd-023`, tạo từ `origin/dev` tại `e8c7402`. Truy vấn Azure trong tác vụ này đều dùng transaction READ ONLY; không deploy, resolve, reset, seed hoặc cập nhật `_prisma_migrations`.

Azure có 24 migration hoàn tất và Git có 26. Không có file đã áp dụng bị thiếu. Account lifecycle có timestamp nhỏ hơn một số migration đã áp dụng, khiến guard applied-prefix báo lỗi chung về thứ tự. SQL drop_sample_storage_units_brand còn dư một LF cuối trong Git; khôi phục đúng 157 byte cho SHA-256 `5814ee69f36d4e669c99ca17775fb4ba78d37e0e9d819774907721b3b5c5177f` khớp Azure.

Guard mới kiểm tra từng migration active theo tên: bắt buộc baseline, file hiện diện, checksum khớp, không duplicate và không unfinished. Các tên chưa áp dụng được trả theo thứ tự làm pending, kể cả khi được merge muộn. Không bỏ qua bất kỳ kiểm tra checksum nào.

## Kết quả thực tế

| Kiểm tra                               | Kết quả                                                               |
| -------------------------------------- | --------------------------------------------------------------------- |
| Regression deployment                  | 10/10 đạt; 3 regression mới thất bại trước sửa và đạt sau sửa         |
| `npm run test:unit`                    | 420/420 đạt, DATABASE_URL placeholder local không kết nối             |
| `npm run test:migrations`              | 14/14 đạt trên PostgreSQL 18 disposable                               |
| `npm run validate`                     | Lint, format, typecheck và build/generate đạt                         |
| Đối chiếu Azure sau sửa, chỉ đọc       | Tất cả tên/checksum active hợp lệ, không unfinished, đúng hai pending |
| Preflight dữ liệu cán bộ ATTP, chỉ đọc | PASS, không phát hiện xung đột                                        |

Test merge muộn dùng bản sao directory migration riêng trong tmp: deploy 24 migration trước, thêm hai file đang chờ, deploy lại thành công. Mọi history row cũ giữ nguyên và Prisma schema diff bằng 0. Hai pending quan sát trên Azure:

- `20261112000100_account_lifecycle_intake`
- `20261115000100_school_dish_categories`

Đã được phép tạo container `foodprint-023-cd-tests-a3f29c7b`, PostgreSQL 18 chỉ bind loopback, dữ liệu tmpfs. Lượt thử đầu dùng cổng cũ bị ECONNREFUSED trước khi kết nối; sau đó đã chạy thành công bằng cổng Docker thực cấp. Container đã dừng và tự xóa bằng --rm; không đụng database hoặc volume khác. Không ghi URL/credential Azure trong tài liệu hoặc log kiểm chứng.

## Triển khai

Bản sửa cần được review/commit và đưa vào dev qua PR, để CI và CD đã được phê duyệt thực hiện deployment. Chưa push hoặc deploy trong tác vụ này; kết quả read-only không phải xác nhận migration pending đã được áp dụng. Không sửa timestamp migration, checksum trong database hoặc dùng resolve để che lỗi.

Prisma validate, git diff --check và định dạng tài liệu đạt. Spec gate được đánh giá với danh sách thay đổi và artifact working tree của nhánh 023: đạt; chưa phải kết quả CI của PR đã tạo. Worktree chính không có thay đổi từ bản sửa này.
