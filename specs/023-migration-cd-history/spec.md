# Fix: Kiểm tra lịch sử migration khi merge muộn

**Branch**: `fix/023-migration-cd-history`
**Ngày**: 2026-11-14
**Trạng thái**: Đã chuẩn bị và kiểm chứng; chưa deploy Azure

## Vấn đề đã xác nhận

CD của dev dừng với lỗi lịch sử database khác thứ tự Git. Đối chiếu Azure chỉ đọc với origin/dev xác nhận không có migration đã áp dụng nào bị thiếu, không có migration chưa hoàn tất; migration account lifecycle được merge sau khi các migration timestamp lớn hơn đã áp dụng. File drop_sample_storage_units_brand còn dư một LF cuối so với byte checksum đã lưu trên Azure.

## Yêu cầu

- FR-001: Xác định migration chờ theo tên chưa có trong lịch sử đã áp dụng, kể cả tên được sắp trước migration đã áp dụng. Kết quả theo thứ tự tên migration trong Git.
- FR-002: Mỗi migration đã áp dụng phải có đúng một file tương ứng và checksum khớp. Từ chối file bị thiếu, checksum sai, tên trùng trong file hoặc lịch sử active.
- FR-003: Giữ bắt buộc baseline 0_init, từ chối migration chưa hoàn tất; chỉ bỏ qua lần chạy được đánh dấu rolled_back rõ ràng.
- FR-004: Khôi phục file 20261113000400_drop_sample_storage_units_brand nguyên byte với checksum Azure `5814ee69f36d4e669c99ca17775fb4ba78d37e0e9d819774907721b3b5c5177f`. Không sửa SQL nghiệp vụ, checksum trong database hoặc lịch sử đã áp dụng.
- FR-005: Tác vụ chỉ chuẩn bị thay đổi Git, kiểm thử và kiểm chứng Azure chỉ đọc. Không deploy Azure, resolve, reset, seed hay tự sửa _prisma_migrations.

## Nghiệm thu

1. Lịch sử có baseline và migration mới hơn, file migration merge muộn tồn tại hợp lệ: trả đúng tên migration chờ.
2. File đã áp dụng bị thiếu hoặc sửa, kể cả sau một migration chờ: từ chối.
3. Active history có duplicate, unfinished hoặc chưa nhận baseline: từ chối; rolled-back attempt không che lỗi active.
4. SHA-256 file được khôi phục bằng đúng checksum đọc từ Azure; dữ liệu Azure không thay đổi khi kiểm chứng.
5. Prisma deploy trên PostgreSQL disposable chấp nhận migration merge muộn, rồi history/checksum và schema vẫn hợp lệ.
