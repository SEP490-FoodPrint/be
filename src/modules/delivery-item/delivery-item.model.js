import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const DeliveryItem = sequelize.define(
  "DeliveryItem",
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
    supply_request_item_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    actual_quantity: {
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
    tableName: "delivery_items",
    schema: "foodprint",
    timestamps: false,
    createdAt: false,
    updatedAt: false,
    underscored: true,
  }
)

export default DeliveryItem
