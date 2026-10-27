import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const FoodSafetyReportForwarding = sequelize.define(
  "FoodSafetyReportForwarding",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    incident_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    recipient_commune_food_safety_unit_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    recipient_organization: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    recipient_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    recipient_email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    recipient_phone: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    forwarding_channel: {
      type: DataTypes.STRING(60),
      allowNull: true,
    },
    reference_number: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    forwarded_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    attempted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    forwarded_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    }
  },
  {
    tableName: "food_safety_report_forwardings",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    underscored: true,
  }
)

export default FoodSafetyReportForwarding
