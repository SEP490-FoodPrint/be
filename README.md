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

## 3. Danh Mục Các Modules Nghiệp Vụ (`src/modules/`)

Hệ thống được tổ chức thành 11 module độc lập trong thư mục `src/modules/`:

| Module | Tên thư mục | Mô tả trách nhiệm & Đối tượng sử dụng |
| :--- | :--- | :--- |
| **Xác thực** | `auth/` | Đăng nhập, cấp phát JWT Token, đổi mật khẩu, xem profile hiện tại. |
| **Tài khoản** | `user/` | Quản lý thông tin tài khoản nhân sự thuộc 9 vai trò. |
| **Tổ chức** | `organization/` | Quản lý danh sách Trường học & Nhà cung cấp, xét duyệt tham gia (`SYSTEM_ADMIN`). |
| **Thực đơn** | `menu/` | Lập thực đơn dinh dưỡng (`SCHOOL_HEALTH_OFFICER`) & Phê duyệt thực đơn (`SCHOOL_MANAGEMENT_BOARD`, `SCHOOL_ADMIN`). |
| **Nguyên liệu** | `ingredient/` | Danh mục nguyên liệu, chứng chỉ VietGAP/HACCP, truy xuất lô hàng (`INGREDIENT_SUPPLIER`). |
| **Đơn cung ứng** | `supply-order/` | Đơn đặt hàng nguyên liệu giữa Nhà trường và Nhà cung cấp. |
| **Kiểm tra** | `inspection/` | Biên bản đồng kiểm tra nguyên liệu đầu vào 3 bên (Y tế, Ban Phụ huynh, Thủ kho). |
| **Bếp ăn** | `kitchen/` | Quản lý các mẻ nấu, giám sát nhiệt độ, phân bổ suất ăn & ghi nhật ký mẫu lưu 24h (`SCHOOL_KITCHEN_STAFF`). |
| **Báo ăn lớp** | `meal-attendance/` | Điểm danh học sinh ăn bán trú & theo dõi phản ứng dị ứng theo lớp học (`HOMEROOM_TEACHER`). |
| **Kho thực phẩm** | `warehouse/` | Quản lý tồn kho thực phẩm, hạn sử dụng, xuất kho chế biến (`INGREDIENT_MANAGEMENT_DEPARTMENT`). |
| **Phản ánh** | `feedback/` | Kênh ý kiến chất lượng bữa ăn của phụ huynh & xử lý sự cố an toàn thực phẩm. |

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
