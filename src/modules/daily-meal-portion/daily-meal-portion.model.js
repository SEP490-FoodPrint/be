import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const DailyMealPortion = sequelize.define(
  "DailyMealPortion",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    class_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    confirmed_by_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    meal_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    meal_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    total_portions: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    allergy_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    finalized_at: {
      type: DataTypes.DATE,
      allowNull: true,
    }
  },
  {
    tableName: "daily_meal_portions",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default DailyMealPortion
