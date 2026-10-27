import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const IngredientLot = sequelize.define(
  "IngredientLot",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    delivery_item_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    source_facility_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    qr_token: {
      type: DataTypes.STRING(160),
      allowNull: false,
    },
    lot_code: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    manufacture_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    expiry_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    received_quantity: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
    },
    available_quantity: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
    },
    unit: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    }
  },
  {
    tableName: "ingredient_lots",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default IngredientLot
