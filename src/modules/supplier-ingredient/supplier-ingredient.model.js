import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const SupplierIngredient = sequelize.define(
  "SupplierIngredient",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    supplier_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    ingredient_name: {
      type: DataTypes.STRING(160),
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING(80),
      allowNull: true,
    },
    unit: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    price_per_unit: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    origin: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "supplier_ingredients",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default SupplierIngredient
