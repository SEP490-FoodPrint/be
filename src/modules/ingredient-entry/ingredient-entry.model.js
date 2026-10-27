import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const IngredientEntry = sequelize.define(
  "IngredientEntry",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    school_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    ingredient_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    storage_requirements: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    shelf_life_days: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    handling_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    created_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    }
  },
  {
    tableName: "ingredient_entries",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default IngredientEntry
