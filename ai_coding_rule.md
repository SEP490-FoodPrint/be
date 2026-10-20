# AI Coding Guidelines & Backend Architecture (FoodPrint BE)

> **CRITICAL INSTRUCTION FOR ALL AI ASSISTANTS & DEVELOPERS:**
> Đây là bộ quy chuẩn kiến trúc bắt buộc cho dự án **FoodPrint Backend**. Bất kỳ ai (kể cả AI Assistant hay Developer) khi triển khai một module mới, viết API mới, hoặc thao tác với Database **PHẢI TUÂN THỦ 100% CÁC NGUYÊN TẮC DƯỚI ĐÂY**.

---

## 1. Nguyên Tắc về Kiến Trúc Module (Modular Architecture)

Dự án áp dụng mô hình **Modular Architecture (Feature-Based Modules)**:
- Mỗi tính năng/nghiệp vụ là một module độc lập tự chứa nằm trong thư mục `src/modules/<feature_name>/`.
- ❌ **CẤM:** Không được tạo controller, model hay route phân tán ở các thư mục dùng chung bên ngoài.
- ✅ **BẮT BUỘC:** Một module hoàn chỉnh gồm tối đa 5 tệp tin chuẩn:

```text
src/modules/<feature_name>/
├── <feature>.model.js       # Định nghĩa Sequelize Model (Bảng PostgreSQL)
├── <feature>.validation.js  # Kiểm tra dữ liệu đầu vào (Payload Validation)
├── <feature>.routes.js      # Khai báo Express Router & gắn Middleware phân quyền
├── <feature>.controller.js  # Nhận req/res, gọi Service và trả về qua response helper
└── <feature>.service.js     # Logic nghiệp vụ lõi & truy vấn Sequelize Database
```

Sau khi tạo xong module, **BẮT BUỘC** đăng ký Router của module đó vào tệp trung tâm:
👉 `src/routes/index.js` (`router.use("/<feature_name>", featureRoutes)`)

---

## 2. Nguyên Tắc về Cơ Sở Dữ Liệu PostgreSQL & Sequelize ORM

- **Hệ CSDL:** PostgreSQL (Database: `foodprint`, User: `postgres`, Password: `123`, Port: `5432`).
- **ORM Tiêu Chuẩn:** `Sequelize` (được export từ `src/config/database.js`).
- **Quy chuẩn đặt tên:** 
  - Tên bảng: Số nhiều (`users`, `menus`, `ingredients`,...).
  - Tên cột: Sử dụng kiểu **snake_case** (đã cấu hình sẵn `underscored: true` trong Sequelize). Ví dụ: `user_id`, `full_name`, `org_type`, `created_at`.
- **An toàn giao dịch (Transactions):** Khi thực hiện các thao tác ghi dữ liệu liên quan đến từ 2 bảng trở lên (ví dụ: tạo thực đơn kèm danh sách món, lưu mẫu thức ăn kèm mẻ nấu), **BẮT BUỘC** sử dụng Managed Transaction của Sequelize:
  ```javascript
  const result = await sequelize.transaction(async (t) => {
    // Các thao tác ghi kèm { transaction: t }
  })
  ```

---

## 3. Nguyên Tắc về Phân Quyền (RBAC 2 Tầng - 1 Account = 1 Role)

Backend là "chốt chặn bảo mật" cuối cùng, đồng bộ với Frontend:

1. **Quy tắc 1 Account = 1 Role:** `req.user.role` là chuỗi `string` đơn lẻ.
2. **Sử dụng Hằng Số Chuẩn:** Luôn import từ `src/constants/roles.js` (`ROLES`, `ORG_TYPES`). Tuyệt đối không hardcode chuỗi string tự do.
3. **Phân quyền 2 tầng:**
   - **Tầng 1 (Cổng tổ chức):** Dùng `requireOrg([ORG_TYPES.SCHOOL, ...])`.
   - **Tầng 2 (Vai trò):** Dùng `requireRoles([ROLES.SCHOOL_HEALTH_OFFICER, ...])`.
4. **Bắt buộc gắn Middleware `authenticate`:** Mọi endpoint nội bộ đều phải qua xác thực token trước khi tới middleware phân quyền:
   ```javascript
   import { authenticate } from "../../middlewares/auth.middleware.js"
   import { requireRoles } from "../../middlewares/role.middleware.js"
   import { ROLES } from "../../constants/roles.js"

   router.use(authenticate) // Bắt buộc đăng nhập
   router.post("/planning", requireRoles([ROLES.SCHOOL_HEALTH_OFFICER]), menuController.create)
   ```

---

## 4. Nguyên Tắc về Chuẩn Hóa Phản Hồi API (Response Standard)

Tuyệt đối **KHÔNG** tự ý `res.json({ ... })` một cách tùy tiện không đúng format. 
Mọi Controller **BẮT BUỘC** sử dụng helper từ `src/utils/response.js`:

```javascript
import { sendSuccess, sendError } from "../../utils/response.js"

// Khi thành công:
return sendSuccess(res, data, "Lấy danh sách thành công", 200)

// Khi lỗi nghiệp vụ:
return sendError(res, "Dữ liệu không hợp lệ", 400, errors)
```

**Cấu trúc JSON phản hồi chuẩn bắt buộc:**
- Thành công: `{ success: true, statusCode: 200, message: "...", data: { ... } }`
- Thất bại: `{ success: false, statusCode: 4xx/5xx, message: "...", error: ... }`

---

## 5. Template Mẫu Chuẩn Khi Triển Khai 1 Module Mới

Dưới đây là mã nguồn mẫu chuẩn cho module `menu` để bạn tham khảo làm khuôn mẫu:

### 5.1. Model (`src/modules/menu/menu.model.js`)
```javascript
import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const Menu = sequelize.define("Menu", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  school_id: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  menu_name: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  week_number: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM("DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"),
    defaultValue: "DRAFT",
  },
  created_by: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
})

export default Menu
```

### 5.2. Service (`src/modules/menu/menu.service.js`)
```javascript
import Menu from "./menu.model.js"

const getMenusBySchool = async (schoolId) => {
  return await Menu.findAll({
    where: { school_id: schoolId },
    order: [["created_at", "DESC"]],
  })
}

const createMenuPlan = async (menuData, userId, schoolId) => {
  return await Menu.create({
    ...menuData,
    school_id: schoolId,
    created_by: userId,
    status: "PENDING_APPROVAL",
  })
}

const MenuService = {
  getMenusBySchool,
  createMenuPlan,
}

export default MenuService
```

### 5.3. Controller (`src/modules/menu/menu.controller.js`)
```javascript
import MenuService from "./menu.service.js"
import { sendSuccess, sendError } from "../../utils/response.js"

const getList = async (req, res, next) => {
  try {
    const schoolId = req.user.orgId
    const data = await MenuService.getMenusBySchool(schoolId)
    return sendSuccess(res, data, "Lấy danh sách thực đơn thành công")
  } catch (error) {
    next(error)
  }
}

const create = async (req, res, next) => {
  try {
    const data = await MenuService.createMenuPlan(req.body, req.user.userId, req.user.orgId)
    return sendSuccess(res, data, "Lập thực đơn thành công", 201)
  } catch (error) {
    next(error)
  }
}

const MenuController = {
  getList,
  create,
}

export default MenuController
```

### 5.4. Route (`src/modules/menu/menu.routes.js`)
```javascript
import { Router } from "express"
import MenuController from "./menu.controller.js"
import { authenticate } from "../../middlewares/auth.middleware.js"
import { requireRoles } from "../../middlewares/role.middleware.js"
import { ROLES } from "../../constants/roles.js"

const router = Router()

// Tất cả endpoints đều cần Bearer Token
router.use(authenticate)

// Ban Y tế lập thực đơn
router.post(
  "/planning",
  requireRoles([ROLES.SCHOOL_HEALTH_OFFICER]),
  MenuController.create
)

// Các role thuộc trường xem danh sách
router.get("/", MenuController.getList)

export default router
```

---

🔥 **TỔNG KẾT BẮT BUỘC:**
1. **Một Module = Một thư mục tự chứa trong `src/modules/<feature>/`**.
2. **Truy vấn Database qua Sequelize Model và kết nối PostgreSQL (`foodprint` / pass: `123`)**.
3. **Phân quyền 1 Account = 1 Role chặt chẽ qua `requireRoles`**.
4. **Trả kết quả qua `sendSuccess` và `sendError`**.
