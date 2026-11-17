# Truy xuất nguồn gốc suất ăn học đường (Meal Traceability)

Truy xuất toàn diện chuỗi cung ứng suất ăn học đường từ lớp học ngược dòng về thực đơn, mẻ nấu, mẫu lưu thức ăn, lô nguyên liệu kho và đơn giao hàng/nhà cung cấp.

- FR-001. Endpoint `GET /api/meal-traceability` nhận query `classId`, `date` (YYYY-MM-DD), `mealType` (LUNCH/AFTERNOON_SNACK) hoặc `mealAllocationId`.
- FR-002. Trả về thông tin trường, lớp, đợt phân bổ suất ăn theo đúng schema hiện tại (`Class`, `School`, `DailyMealPortion`, `MealAllocation`).
- FR-003. Trả về danh sách món ăn trong thực đơn ngày (`MenuDayDish`, `Dish`) và các mẻ nấu cấu thành (`MealAllocationBatch`, `CookingBatch`).
- FR-004. Với từng mẻ nấu, kèm thông tin mẫu lưu kiểm nghiệm (`RetainedFoodSample` gồm số lượng, vị trí lưu, trạng thái và ảnh niêm phong nếu có).
- FR-005. Trích xuất định lượng nguyên liệu (`CookingBatchLot`), lô nguyên liệu (`IngredientLot`), cơ sở sản xuất (`SourceFacility`), đơn giao hàng (`Delivery`), nhà cung cấp (`Supplier`), chứng nhận (`SupplierCertification`), và duyệt kiểm thực (`DeliveryApproval`).
- FR-006. Tích hợp chuỗi bằng chứng Blockchain tự động thông qua publicMealAllocationChain của blockchainProofService, đóng gói 5 chặng bằng chứng số và hỗ trợ verify=true đối soát on-chain.
- FR-007. Sử dụng 100% database schema hiện có, tuyệt đối không tạo migration hay bảng mới.
