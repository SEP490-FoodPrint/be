# FoodPrint Backend API (Modular Architecture)

Hệ thống Backend cho nền tảng Quản lý và Truy xuất Nguồn gốc Suất ăn Học đường **FoodPrint**.

Dự án được xây dựng trên nền tảng **Node.js (Express) + PostgreSQL (Sequelize ORM)** theo mô hình **Modular Architecture (Kiến trúc phân rã theo Feature Module độc lập)**, kết nối đồng bộ 100% với Frontend `FoodPrintFE`.

---

## 1. Thông Số Cơ Sở Dữ Liệu (PostgreSQL)

- **Database:** `foodprint`
- **Username:** `postgres`
- **Password:** `123`
- **Host / Port:** `localhost:5432`
- **ORM:** `Sequelize`

> **Lưu ý:** Hãy đảm bảo service PostgreSQL đã được khởi chạy và database `foodprint` đã được tạo trên máy trước khi chạy ứng dụng (`CREATE DATABASE foodprint;`).

---

## 2. Khởi Chạy Dự Án

```bash
# Cài đặt thư viện
npm install

# Khởi chạy chế độ phát triển (Auto reload bằng nodemon)
npm run dev

# Khởi chạy production
npm start
```

- Server URL: **http://localhost:5000**
- Health Check: **http://localhost:5000/api/health**
- Frontend tương thích: **http://localhost:3001**

---

## 3. Danh Mục 43 Modules Nghiệp Vụ Chuẩn Hóa (`src/modules/`)

Toàn bộ 43 modules độc lập tương ứng với 41 bảng vật lý từ `DB_script.txt` (schema `foodprint`) cùng 2 modules nghiệp vụ mở rộng (`auth`, `supplier-ingredient`):
- Mỗi module bao gồm đầy đủ 6 tệp: `<feature>.model.js`, `<feature>.validation.js`, `<feature>.middleware.js`, `<feature>.service.js`, `<feature>.controller.js`, `<feature>.routes.js`.
- Mỗi module cung cấp tối thiểu 5 API chuẩn: `POST /` (Tạo mới), `GET /` (Danh sách kèm phân trang & lọc), `GET /:id` (Chi tiết), `PUT /:id` (Cập nhật), `DELETE /:id` (Xóa).
- Đăng ký định tuyến tập trung tại `src/routes/index.js` dưới tiền tố `/api/<resource-name>`.

| STT | Tên Module (`src/modules/`) | Route Prefix | Diễn Giải Nghiệp Vụ |
|:---:|:---|:---|:---|
| 1 | `auth` | `/api/auth` | Xác thực đăng nhập JWT, đổi mật khẩu, xem profile, quản lý phiên |
| 2 | `role` | `/api/roles` | Danh mục 11 vai trò người dùng trong hệ thống FoodPrint |
| 3 | `school` | `/api/schools` | Thông tin trường học, thiết lập cooking_mode & giờ ăn |
| 4 | `supplier` | `/api/suppliers` | Thông tin nhà cung cấp thực phẩm |
| 5 | `commune-food-safety-unit` | `/api/commune-food-safety-units` | Trạm y tế / Ban an toàn thực phẩm cấp xã/phường |
| 6 | `supplier-certification` | `/api/supplier-certifications` | Giấy chứng nhận ATTP, HACCP, VietGAP của NCC |
| 7 | `user` | `/api/users` | Danh sách tài khoản người dùng (1 user = 1 role) |
| 8 | `source-facility` | `/api/source-facilities` | Cơ sở sản xuất, vùng trồng, trại chăn nuôi của NCC |
| 9 | `registration-request` | `/api/registration-requests` | Hồ sơ yêu cầu tham gia mạng lưới FoodPrint |
| 10 | `school-supplier-relationship` | `/api/school-supplier-relationships` | Hợp đồng / Liên kết cung ứng giữa Trường và NCC |
| 11 | `class` | `/api/classes` | Danh sách lớp học bán trú |
| 12 | `daily-meal-portion` | `/api/daily-meal-portions` | Báo cáo chốt suất ăn hàng ngày theo lớp (GVCN) |
| 13 | `class-allergy` | `/api/class-allergies` | Hồ sơ dị ứng theo lớp học |
| 14 | `daily-allergy-portion` | `/api/daily-allergy-portions` | Suất ăn dị ứng chi tiết từng ngày |
| 15 | `ingredient` | `/api/ingredients` | Danh mục nguyên liệu chuẩn & nguyên liệu NCC |
| 16 | `supplier-ingredient` | `/api/supplier-ingredients` | Mặt hàng nguyên liệu chào giá của từng NCC |
| 17 | `ingredient-entry` | `/api/ingredient-entries` | Mã nguyên liệu nội bộ của trường (DRY_STOCK / DIRECT_USE) |
| 18 | `supply-request` | `/api/supply-requests` | Đơn đặt hàng nguyên liệu từ trường gửi NCC |
| 19 | `supply-request-item` | `/api/supply-request-items` | Chi tiết mặt hàng trong đơn đặt hàng |
| 20 | `delivery` | `/api/deliveries` | Chuyến xe giao hàng từ NCC đến trường học |
| 21 | `delivery-approval` | `/api/delivery-approvals` | Biên bản kiểm tra nghiệm thu giao nhận 4 bên |
| 22 | `delivery-item` | `/api/delivery-items` | Chi tiết các món hàng thực tế trong chuyến giao |
| 23 | `ingredient-lot` | `/api/ingredient-lots` | Lô nguyên liệu nhập kho (HSD, mã QR token, cơ sở nguồn) |
| 24 | `inventory-transaction` | `/api/inventory-transactions` | Sổ kho ghi nhận biến động nhập/xuất/hủy/điều chỉnh |
| 25 | `weekly-menu` | `/api/weekly-menus` | Thực đơn tuần của trường học |
| 26 | `menu-day` | `/api/menu-days` | Chi tiết từng ngày ăn trong tuần |
| 27 | `dish` | `/api/dishes` | Danh mục các món ăn của trường |
| 28 | `menu-day-dish` | `/api/menu-day-dishes` | Phân bổ món ăn vào các bữa ăn (trưa/xế) theo ngày |
| 29 | `dish-ingredient-entry` | `/api/dish-ingredient-entries` | Định lượng nguyên liệu cho 1 suất ăn chuẩn của món |
| 30 | `menu-review-record` | `/api/menu-review-records` | Nhật ký phê duyệt / yêu cầu chỉnh sửa thực đơn (BGH) |
| 31 | `cooking-batch` | `/api/cooking-batches` | Mẻ nấu chế biến món ăn thực tế tại bếp trường |
| 32 | `cooking-batch-lot` | `/api/cooking-batch-lots` | Ánh xạ lô nguyên liệu xuất kho dùng cho mẻ nấu |
| 33 | `retained-food-sample` | `/api/retained-food-samples` | Mẫu thức ăn lưu nghiệm 24h kèm vị trí và nhiệt độ |
| 34 | `meal-allocation` | `/api/meal-allocations` | Phân bổ suất ăn mẻ nấu về các lớp |
| 35 | `meal-allocation-batch` | `/api/meal-allocation-batches` | Chi tiết mẻ nấu cấu thành phần ăn của từng lớp |
| 36 | `meal-complaint` | `/api/meal-complaints` | Phản ánh / khiếu nại chất lượng bữa ăn từ phụ huynh/GV |
| 37 | `food-safety-incident` | `/api/food-safety-incidents` | Hồ sơ sự cố ngộ độc / mất an toàn thực phẩm |
| 38 | `food-safety-incident-allocation` | `/api/food-safety-incident-allocations` | Danh sách lớp/suất ăn liên đới trong sự cố |
| 39 | `ingredient-quality-feedback` | `/api/ingredient-quality-feedback` | Phản ánh chất lượng nguyên liệu giao hàng cho NCC |
| 40 | `food-safety-report-forwarding` | `/api/food-safety-report-forwardings` | Nhật ký chuyển tiếp báo cáo sự cố tới Trạm y tế / CQCN |
| 41 | `food-analysis-result` | `/api/food-analysis-results` | Kết quả xét nghiệm mẫu thực phẩm sự cố |
| 42 | `incident-school-alert` | `/api/incident-school-alerts` | Cảnh báo ATTP gửi tới các trường học lân cận |
| 43 | `traceability-anchor` | `/api/traceability-anchors` | Băm dữ liệu neo xác thực nguồn gốc Blockchain (SHA-256) |

---

## 4. Cấu Trúc Thư Mục Dự Án

```text
FoodPrintBE/
├── src/
│   ├── config/                     # Cấu hình môi trường & kết nối DB
│   │   └── database.js             # Kết nối PostgreSQL (Sequelize instance)
│   ├── constants/                  # Hằng số hệ thống
│   │   └── roles.js                # ORG_TYPES (SYSTEM/SCHOOL/SUPPLIER), ROLES (9 roles)
│   ├── middlewares/                # Bộ lọc yêu cầu
│   │   ├── auth.middleware.js      # Xác thực Bearer Token (JWT Verify)
│   │   ├── role.middleware.js      # requireRoles([...]) & requireOrg(...)
│   │   └── error.middleware.js     # Bắt lỗi toàn cục & 404 handler
│   ├── utils/                      # Hàm tiện ích dùng chung
│   │   ├── response.js             # Chuẩn hóa JSON { success, statusCode, message, data }
│   │   └── jwt.js                  # Tạo & kiểm tra JWT Token
│   ├── modules/                    # CÁC MODULE NGHIỆP VỤ (SELF-CONTAINED)
│   │   ├── auth/
│   │   ├── user/
│   │   ├── organization/
│   │   ├── menu/
│   │   ├── ingredient/
│   │   ├── supply-order/
│   │   ├── inspection/
│   │   ├── kitchen/
│   │   ├── meal-attendance/
│   │   ├── warehouse/
│   │   └── feedback/
│   ├── routes/
│   │   └── index.js                # Đăng ký tập trung routes các modules
│   ├── app.js                      # Cấu hình Express app & middlewares
│   └── server.js                   # Entry point khởi chạy HTTP Server
├── .env                            # Biến môi trường (DB, Port, JWT)
├── .env.example
├── .gitignore
├── ai_coding_rule.md               # Quy chuẩn code bắt buộc cho AI & Developers
└── package.json
```

---

## 5. Quy Chuẩn Phát Triển Tính Năng

> Mọi lập trình viên và AI Assistant khi code module mới **BẮT BUỘC ĐỌC VÀ TUÂN THỦ** tệp:
> 👉 **`ai_coding_rule.md`**
