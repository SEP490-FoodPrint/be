import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const CookingBatch = sequelize.define(
  "CookingBatch",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    batch_code: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    menu_day_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    dish_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    meal_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    cooking_mode_applied: {
      type: DataTypes.STRING(50),
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
    planned_portions: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    prepared_portions: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    confirmed_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    confirmed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    completed_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    REFERENCES: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: false,
    }
  },
  {
    tableName: "cooking_batches",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default CookingBatch
