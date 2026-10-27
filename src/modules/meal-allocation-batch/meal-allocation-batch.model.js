import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const MealAllocationBatch = sequelize.define(
  "MealAllocationBatch",
  {
    meal_allocation_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    cooking_batch_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    allocated_portions: {
      type: DataTypes.INTEGER,
      allowNull: false,
    }
  },
  {
    tableName: "meal_allocation_batches",
    schema: "foodprint",
    timestamps: false,
    createdAt: false,
    updatedAt: false,
    underscored: true,
  }
)

export default MealAllocationBatch
