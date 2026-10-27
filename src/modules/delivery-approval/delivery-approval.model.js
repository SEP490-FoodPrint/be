import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const DeliveryApproval = sequelize.define(
  "DeliveryApproval",
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
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    role_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    decision: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    decided_at: {
      type: DataTypes.DATE,
      allowNull: false,
    }
  },
  {
    tableName: "delivery_approvals",
    schema: "foodprint",
    timestamps: false,
    createdAt: false,
    updatedAt: false,
    underscored: true,
  }
)

export default DeliveryApproval
