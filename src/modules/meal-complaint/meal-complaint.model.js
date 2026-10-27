import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const MealComplaint = sequelize.define(
  "MealComplaint",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    meal_allocation_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    submitted_by_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    complaint_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    handled_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    resolution: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    submitted_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    OR: {
      type: DataTypes.STRING(50),
      allowNull: false,
    }
  },
  {
    tableName: "meal_complaints",
    schema: "foodprint",
    timestamps: true,
    createdAt: false,
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default MealComplaint
