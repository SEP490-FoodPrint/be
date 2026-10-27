import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const IncidentSchoolAlert = sequelize.define(
  "IncidentSchoolAlert",
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
    target_school_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    sent_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    attempted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    sent_at: {
      type: DataTypes.DATE,
      allowNull: true,
    }
  },
  {
    tableName: "incident_school_alerts",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    underscored: true,
  }
)

export default IncidentSchoolAlert
