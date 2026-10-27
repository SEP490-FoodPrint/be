import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const InventoryTransaction = sequelize.define(
  "InventoryTransaction",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    ingredient_lot_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    movement_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    quantity: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
    },
    unit: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    created_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    reference_type: {
      type: DataTypes.STRING(80),
      allowNull: true,
    },
    reference_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    occurred_at: {
      type: DataTypes.DATE,
      allowNull: false,
    }
  },
  {
    tableName: "inventory_transactions",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    underscored: true,
  }
)

export default InventoryTransaction
