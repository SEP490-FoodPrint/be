import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const CookingBatchLot = sequelize.define(
  "CookingBatchLot",
  {
    cooking_batch_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    ingredient_lot_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    planned_quantity: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
    },
    quantity_used: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: true,
    },
    unit: {
      type: DataTypes.STRING(30),
      allowNull: false,
    }
  },
  {
    tableName: "cooking_batch_lots",
    schema: "foodprint",
    timestamps: false,
    createdAt: false,
    updatedAt: false,
    underscored: true,
  }
)

export default CookingBatchLot
