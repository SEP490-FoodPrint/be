// Nhóm tổ chức (Portal cấp 1)
export const ORG_TYPES = {
  SYSTEM: "SYSTEM",
  SCHOOL: "SCHOOL",
  SUPPLIER: "SUPPLIER",
}

// 9 Vai trò nghiệp vụ của hệ thống FoodPrint (1 account = 1 role)
export const ROLES = {
  // Nhóm SYSTEM
  SYSTEM_ADMIN: "SYSTEM_ADMIN",

  // Nhóm SUPPLIER
  INGREDIENT_SUPPLIER: "INGREDIENT_SUPPLIER",

  // Nhóm SCHOOL
  SCHOOL_ADMIN: "SCHOOL_ADMIN",
  SCHOOL_MANAGEMENT_BOARD: "SCHOOL_MANAGEMENT_BOARD", // Ban giám hiệu
  SCHOOL_HEALTH_OFFICER: "SCHOOL_HEALTH_OFFICER",     // Ban y tế
  SCHOOL_KITCHEN_STAFF: "SCHOOL_KITCHEN_STAFF",       // Nhân viên bếp
  HOMEROOM_TEACHER: "HOMEROOM_TEACHER",               // Giáo viên chủ nhiệm
  PARENTS_COMMITTEE: "PARENTS_COMMITTEE",             // Ban phụ huynh
  INGREDIENT_MANAGEMENT: "INGREDIENT_MANAGEMENT_DEPARTMENT", // Bộ phận quản lý kho/nguyên liệu
}

// Tên hiển thị tiếng Việt của các role
export const ROLE_LABELS = {
  [ROLES.SYSTEM_ADMIN]: "Quản trị viên Hệ thống (System Admin)",
  [ROLES.INGREDIENT_SUPPLIER]: "Nhà cung cấp Nguyên liệu (Supplier)",
  [ROLES.SCHOOL_ADMIN]: "Quản trị viên Nhà trường (School Admin)",
  [ROLES.SCHOOL_MANAGEMENT_BOARD]: "Ban Giám Hiệu",
  [ROLES.SCHOOL_HEALTH_OFFICER]: "Cán bộ Y tế Trường",
  [ROLES.SCHOOL_KITCHEN_STAFF]: "Nhân viên Bếp / Bếp trưởng",
  [ROLES.HOMEROOM_TEACHER]: "Giáo viên Chủ nhiệm",
  [ROLES.PARENTS_COMMITTEE]: "Ban Đại diện Phụ huynh",
  [ROLES.INGREDIENT_MANAGEMENT]: "Bộ phận Quản lý Kho & Nguyên liệu",
}
