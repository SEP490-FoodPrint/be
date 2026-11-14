# Kế hoạch

Repository danh mục sắp xếp `createdAt` giảm dần và `id` giảm dần trước phân trang. Frontend tải đủ các trang theo thứ tự đó, gom nhóm ổn định theo lần xuất hiện đầu tiên sau khi lọc, sau đó phân trang giao diện.

## Constitution Check

- I: Thứ tự truy vấn thuộc repository, gom nhóm hiển thị thuộc frontend.
- II: Giữ nguyên quyền và phạm vi trường.
- III: Không sửa schema hoặc dữ liệu.
- IV: Không thay đổi transaction hoặc cache.
- V: Giữ nguyên hợp đồng HTTP.
- VI: Spec, plan, tasks cùng nhánh `feat/dish-catalog-order`.

Kiểm thử thứ tự truy vấn, gom nhóm, phân trang và build hai ứng dụng.
