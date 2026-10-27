import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const FoodSafetyIncidentAllocation = sequelize.define(
  "FoodSafetyIncidentAllocation",
  {
    incident_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    meal_allocation_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    }
  },
  {
    tableName: "food_safety_incident_allocations",
    schema: "foodprint",
    timestamps: false,
    createdAt: false,
    updatedAt: false,
    underscored: true,
  }
)

export default FoodSafetyIncidentAllocation
