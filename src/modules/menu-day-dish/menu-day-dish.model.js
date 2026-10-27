import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const MenuDayDish = sequelize.define(
  "MenuDayDish",
  {
    menu_day_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    dish_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    meal_type: {
      type: DataTypes.STRING(50),
      primaryKey: true,
    },
    portion_size: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: true,
    },
    portion_unit: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    display_order: {
      type: DataTypes.INTEGER,
      allowNull: true,
    }
  },
  {
    tableName: "menu_day_dishes",
    schema: "foodprint",
    timestamps: false,
    createdAt: false,
    updatedAt: false,
    underscored: true,
  }
)

export default MenuDayDish
