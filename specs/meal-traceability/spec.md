# Truy xuất nguồn gốc suất ăn học đường (Meal Traceability)

Truy xuất toàn diện chuỗi cung ứng suất ăn học đường từ lớp học ngược dòng về thực đơn, mẻ nấu, mẫu lưu thức ăn, lô nguyên liệu kho và đơn giao hàng/nhà cung cấp.

- FR-001. Endpoint `GET /api/meal-traceability` nhận query `classId`, `date` (YYYY-MM-DD), `mealType` (LUNCH/AFTERNOON) hoặc `mealAllocationId`.
- FR-002. Trả về thông tin trường, lớp, đợt phân bổ suất ăn theo đúng schema hiện tại (`Class`, `School`, `DailyMealPortion`, `MealAllocation`).
- FR-003. Trả về danh sách món ăn trong thực đơn ngày (`MenuDayDish`, `Dish`) và các mẻ nấu cấu thành (`MealAllocationBatch`, `CookingBatch`).
- FR-004. Với từng mẻ nấu, kèm thông tin mẫu lưu kiểm nghiệm (`RetainedFoodSample` gồm số lượng, vị trí lưu, trạng thái và ảnh niêm phong nếu có).
- FR-005. Trích xuất định lượng nguyên liệu (`CookingBatchLot`), lô nguyên liệu (`IngredientLot`), cơ sở sản xuất (`SourceFacility`), đơn giao hàng (`Delivery`), nhà cung cấp (`Supplier`), chứng nhận (`SupplierCertification`), và duyệt kiểm thực (`DeliveryApproval`).
- FR-006. Tích hợp chuỗi bằng chứng Blockchain tự động thông qua publicMealAllocationChain của blockchainProofService, đóng gói 5 chặng bằng chứng số và hỗ trợ verify=true đối soát on-chain.
- FR-007. Sử dụng 100% database schema hiện có, tuyệt đối không tạo migration hay bảng mới.

## US1. Truy xuất bữa ăn theo khối và món

Phụ huynh và người dùng nhà trường có thể mở hành trình của một món từ thực đơn theo khối, ngày và bữa.

- FR-008. Endpoint công khai `GET /api/meal-traceability/grade` nhận `gradeId` (UUID), `date` (YYYY-MM-DD), `mealType` (LUNCH/AFTERNOON), cùng `schoolCode` và `verify` tùy chọn. Nếu cung cấp mã trường, khối phải thuộc đúng trường đó. Query sai trả 400. Không có phân bổ phù hợp trả 404.
- FR-009. Tổng hợp phân bổ chưa hủy theo món, gộp mẻ dùng chung giữa các lớp và nhóm lô nguyên liệu theo nhà cung cấp, đơn giao. Trả mốc tiếp nhận, nấu, lưu mẫu và phát suất. Phản hồi chỉ chứa thông tin truy xuất công khai, không công bố số suất từng lớp hay toàn khối.
- FR-010. Đối soát blockchain theo cùng trường, khối, ngày và bữa khi `verify=true`. Lỗi blockchain không chặn dữ liệu truy xuất, và kết quả kiểm tra công khai không được ghi vào cơ sở dữ liệu.
- FR-011. Thực đơn công khai hiển thị định lượng nguyên liệu chính của một suất. Khi mọi đơn vị đổi được sang gam thì trả tổng gam. Nếu có đơn vị đếm, gom số lượng theo từng đơn vị gốc.
