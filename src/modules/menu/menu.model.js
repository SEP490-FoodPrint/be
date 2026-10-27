import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"
import Ingredient from "../ingredient/ingredient.model.js"
import { School, Supplier } from "../organization/organization.model.js"
import User from "../user/user.model.js"

export const WeeklyMenu = sequelize.define(
  "WeeklyMenu",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    school_id: { type: DataTypes.UUID, allowNull: false },
    code: { type: DataTypes.STRING(60), allowNull: false, unique: true },
    title: { type: DataTypes.STRING(220), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    week_number: { type: DataTypes.INTEGER, allowNull: false },
    start_date: { type: DataTypes.DATEONLY, allowNull: false },
    end_date: { type: DataTypes.DATEONLY, allowNull: false },
    status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "DRAFT" },
    total_classes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    total_students: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    proposer_name: { type: DataTypes.STRING(150), allowNull: true },
    proposer_detail: { type: DataTypes.STRING(200), allowNull: true },
    submitted_at: { type: DataTypes.DATE, allowNull: true },
  },
  { tableName: "weekly_menus" }
)

export const MenuDay = sequelize.define(
  "MenuDay",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    weekly_menu_id: { type: DataTypes.UUID, allowNull: false },
    service_date: { type: DataTypes.DATEONLY, allowNull: false },
    day_order: { type: DataTypes.INTEGER, allowNull: false },
    portion_count: { type: DataTypes.INTEGER, allowNull: false },
  },
  {
    tableName: "menu_days",
    indexes: [{ unique: true, fields: ["weekly_menu_id", "service_date"] }],
  }
)

export const Dish = sequelize.define(
  "Dish",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    school_id: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(220), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    dish_type: { type: DataTypes.STRING(30), allowNull: false },
    allergen_label: { type: DataTypes.STRING(100), allowNull: true },
    warning_level: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "neutral" },
  },
  { tableName: "dishes" }
)

export const MenuDayDish = sequelize.define(
  "MenuDayDish",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    menu_day_id: { type: DataTypes.UUID, allowNull: false },
    dish_id: { type: DataTypes.UUID, allowNull: false },
    meal_type: { type: DataTypes.STRING(20), allowNull: false },
    serving_time: { type: DataTypes.STRING(30), allowNull: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    portion: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    portion_unit: { type: DataTypes.STRING(30), allowNull: true },
  },
  {
    tableName: "menu_day_dishes",
    indexes: [{ unique: true, fields: ["menu_day_id", "dish_id", "meal_type"] }],
  }
)

export const DishIngredientEntry = sequelize.define(
  "DishIngredientEntry",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    dish_id: { type: DataTypes.UUID, allowNull: false },
    ingredient_id: { type: DataTypes.UUID, allowNull: false },
    quantity: { type: DataTypes.DECIMAL(12, 3), allowNull: true },
    unit: { type: DataTypes.STRING(30), allowNull: true },
  },
  {
    tableName: "dish_ingredient_entries",
    indexes: [{ unique: true, fields: ["dish_id", "ingredient_id"] }],
  }
)

export const MenuReviewRecord = sequelize.define(
  "MenuReviewRecord",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    weekly_menu_id: { type: DataTypes.UUID, allowNull: false },
    reviewer_id: { type: DataTypes.UUID, allowNull: false },
    review_type: { type: DataTypes.STRING(30), allowNull: false },
    decision: { type: DataTypes.STRING(40), allowNull: false },
    comment: { type: DataTypes.TEXT, allowNull: true },
    reviewed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    metadata: { type: DataTypes.JSONB, allowNull: true },
  },
  { tableName: "menu_review_records" }
)

School.hasMany(WeeklyMenu, { foreignKey: "school_id", as: "weeklyMenus" })
WeeklyMenu.belongsTo(School, { foreignKey: "school_id", as: "school" })
WeeklyMenu.hasMany(MenuDay, { foreignKey: "weekly_menu_id", as: "days" })
MenuDay.belongsTo(WeeklyMenu, { foreignKey: "weekly_menu_id", as: "weeklyMenu" })
MenuDay.hasMany(MenuDayDish, { foreignKey: "menu_day_id", as: "menuItems" })
MenuDayDish.belongsTo(MenuDay, { foreignKey: "menu_day_id", as: "menuDay" })
Dish.hasMany(MenuDayDish, { foreignKey: "dish_id", as: "menuPlacements" })
MenuDayDish.belongsTo(Dish, { foreignKey: "dish_id", as: "dish" })
MenuDay.belongsToMany(Dish, {
  through: MenuDayDish,
  foreignKey: "menu_day_id",
  otherKey: "dish_id",
  as: "dishes",
})
Dish.belongsToMany(MenuDay, {
  through: MenuDayDish,
  foreignKey: "dish_id",
  otherKey: "menu_day_id",
  as: "menuDays",
})
Dish.belongsToMany(Ingredient, {
  through: DishIngredientEntry,
  foreignKey: "dish_id",
  otherKey: "ingredient_id",
  as: "ingredients",
})
Ingredient.belongsToMany(Dish, {
  through: DishIngredientEntry,
  foreignKey: "ingredient_id",
  otherKey: "dish_id",
  as: "dishes",
})
Supplier.hasMany(Ingredient, { foreignKey: "supplier_id", as: "ingredients" })
Ingredient.belongsTo(Supplier, { foreignKey: "supplier_id", as: "supplier" })
WeeklyMenu.hasMany(MenuReviewRecord, { foreignKey: "weekly_menu_id", as: "reviews" })
MenuReviewRecord.belongsTo(WeeklyMenu, { foreignKey: "weekly_menu_id", as: "weeklyMenu" })
User.hasMany(MenuReviewRecord, { foreignKey: "reviewer_id", as: "menuReviews" })
MenuReviewRecord.belongsTo(User, { foreignKey: "reviewer_id", as: "reviewer" })

export default {
  WeeklyMenu,
  MenuDay,
  Dish,
  MenuDayDish,
  DishIngredientEntry,
  MenuReviewRecord,
}
