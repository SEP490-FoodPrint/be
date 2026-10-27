import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const SupplyRequestItem = sequelize.define(
  "SupplyRequestItem",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    supply_request_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    ingredient_entry_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    requested_quantity: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
    },
    unit: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    }
  },
  {
    tableName: "supply_request_items",
    schema: "foodprint",
    timestamps: false,
    createdAt: false,
    updatedAt: false,
    underscored: true,
  }
)

export default SupplyRequestItem
