import Dish from "../dish/dish.model.js"
import DishIngredientEntry from "../dish-ingredient-entry/dish-ingredient-entry.model.js"
import Ingredient from "../ingredient/ingredient.model.js"
import IngredientEntry from "../ingredient-entry/ingredient-entry.model.js"
import MenuDay from "../menu-day/menu-day.model.js"
import MenuDayDish from "../menu-day-dish/menu-day-dish.model.js"
import MenuReviewRecord from "../menu-review-record/menu-review-record.model.js"
import School from "../school/school.model.js"
import Supplier from "../supplier/supplier.model.js"
import User from "../user/user.model.js"
import WeeklyMenu from "../weekly-menu/weekly-menu.model.js"

School.hasMany(WeeklyMenu, { foreignKey: "school_id", as: "weeklyMenus" })
WeeklyMenu.belongsTo(School, { foreignKey: "school_id", as: "school" })
WeeklyMenu.hasMany(MenuDay, { foreignKey: "weekly_menu_id", as: "days" })
MenuDay.belongsTo(WeeklyMenu, { foreignKey: "weekly_menu_id", as: "weeklyMenu" })
MenuDay.hasMany(MenuDayDish, { foreignKey: "menu_day_id", as: "menuItems" })
MenuDayDish.belongsTo(MenuDay, { foreignKey: "menu_day_id", as: "menuDay" })
Dish.hasMany(MenuDayDish, { foreignKey: "dish_id", as: "menuPlacements" })
MenuDayDish.belongsTo(Dish, { foreignKey: "dish_id", as: "dish" })
Dish.hasMany(DishIngredientEntry, { foreignKey: "dish_id", as: "ingredientLinks" })
DishIngredientEntry.belongsTo(Dish, { foreignKey: "dish_id", as: "dish" })
IngredientEntry.hasMany(DishIngredientEntry, { foreignKey: "ingredient_entry_id", as: "dishLinks" })
DishIngredientEntry.belongsTo(IngredientEntry, { foreignKey: "ingredient_entry_id", as: "ingredientEntry" })
Ingredient.hasMany(IngredientEntry, { foreignKey: "ingredient_id", as: "schoolEntries" })
IngredientEntry.belongsTo(Ingredient, { foreignKey: "ingredient_id", as: "ingredient" })
Supplier.hasMany(Ingredient, { foreignKey: "supplier_id", as: "ingredients" })
Ingredient.belongsTo(Supplier, { foreignKey: "supplier_id", as: "supplier" })
WeeklyMenu.hasMany(MenuReviewRecord, { foreignKey: "weekly_menu_id", as: "reviews" })
MenuReviewRecord.belongsTo(WeeklyMenu, { foreignKey: "weekly_menu_id", as: "weeklyMenu" })
User.hasMany(MenuReviewRecord, { foreignKey: "reviewer_user_id", as: "menuReviews" })
MenuReviewRecord.belongsTo(User, { foreignKey: "reviewer_user_id", as: "reviewer" })

export { Dish, DishIngredientEntry, IngredientEntry, MenuDay, MenuDayDish, MenuReviewRecord, WeeklyMenu }
export default { Dish, DishIngredientEntry, IngredientEntry, MenuDay, MenuDayDish, MenuReviewRecord, WeeklyMenu }
