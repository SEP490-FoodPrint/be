import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const TraceabilityAnchor = sequelize.define(
  "TraceabilityAnchor",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    delivery_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    ingredient_lot_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    cooking_batch_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    meal_allocation_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    food_safety_incident_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    payload_hash: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    hash_algorithm: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    network_name: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    contract_address: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    transaction_hash: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    block_number: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
    anchor_status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    verification_status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    verified_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    verification_result: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    }
  },
  {
    tableName: "traceability_anchors",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default TraceabilityAnchor
