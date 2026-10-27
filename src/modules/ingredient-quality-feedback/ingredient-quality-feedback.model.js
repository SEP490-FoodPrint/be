import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const IngredientQualityFeedback = sequelize.define(
  "IngredientQualityFeedback",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    delivery_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    ingredient_lot_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    submitted_by_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(255),
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
    supplier_response: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    responded_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    responded_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: false,
    }
  },
  {
    tableName: "ingredient_quality_feedback",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default IngredientQualityFeedback
