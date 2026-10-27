import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const ClassAllergy = sequelize.define(
  "ClassAllergy",
  {
    class_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    ingredient_entry_id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    affected_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    updated_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    }
  },
  {
    tableName: "class_allergies",
    schema: "foodprint",
    timestamps: true,
    createdAt: false,
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default ClassAllergy
