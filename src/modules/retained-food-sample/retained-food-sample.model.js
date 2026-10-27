import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const RetainedFoodSample = sequelize.define(
  "RetainedFoodSample",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    cooking_batch_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    recorded_by_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    sampled_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    quantity: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: true,
    },
    unit: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    storage_location: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    disposed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    disposal_note: {
      type: DataTypes.TEXT,
      allowNull: true,
    }
  },
  {
    tableName: "retained_food_samples",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default RetainedFoodSample
