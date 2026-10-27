import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const DailyAllergyPortion = sequelize.define(
  "DailyAllergyPortion",
  {
    daily_meal_portion_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    class_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    ingredient_entry_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    portion_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    REFERENCES: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    ON: {
      type: DataTypes.STRING(50),
      allowNull: true,
    }
  },
  {
    tableName: "daily_allergy_portions",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default DailyAllergyPortion
