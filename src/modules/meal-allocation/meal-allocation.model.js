import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const MealAllocation = sequelize.define(
  "MealAllocation",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    daily_meal_portion_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    created_by_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    allocated_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    distributed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    distributed_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    finalized_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    }
  },
  {
    tableName: "meal_allocations",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default MealAllocation
