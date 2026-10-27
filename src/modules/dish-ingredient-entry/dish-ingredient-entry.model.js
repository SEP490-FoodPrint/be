import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const DishIngredientEntry = sequelize.define(
  "DishIngredientEntry",
  {
    dish_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    ingredient_entry_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    required_quantity: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
    },
    unit: {
      type: DataTypes.STRING(30),
      allowNull: false,
    }
  },
  {
    tableName: "dish_ingredient_entries",
    schema: "foodprint",
    timestamps: false,
    createdAt: false,
    updatedAt: false,
    underscored: true,
  }
)

export default DishIngredientEntry
