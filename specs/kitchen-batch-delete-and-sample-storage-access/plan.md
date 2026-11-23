# Plan

1. Kitchen: xóa route `DELETE /:id`, `controller.remove`, `service.remove`, `repository.removeEmptyGroup`; cập nhật chú thích route.
2. Sample storage: thêm `requirePermission("retained_sample.view")` cho các route đọc và `requirePermission("retained_sample.update")` cho các route ghi trong `sample-storage.routes.ts`.
3. Test:
   - `tests/modules.test.ts`: bỏ `DELETE /kitchen/:id` khỏi danh sách route cần đăng nhập.
   - `tests/authorization.integration.test.ts`: bỏ các lời gọi `remove`, kiểm tra service không còn `remove`.
   - `tests/sample-storage.test.ts`: tài khoản không có quyền nhận 403 ở cả 5 thao tác; chỉ có quyền xem thì xem được nhưng không thêm được tủ.
