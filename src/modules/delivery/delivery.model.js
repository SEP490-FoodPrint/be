import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const Delivery = sequelize.define(
  "Delivery",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    delivery_no: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    supply_request_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    supplier_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    created_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    expected_arrival_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    arrived_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    received_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    received_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    vehicle_plate: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    }
  },
  {
    tableName: "deliveries",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default Delivery
