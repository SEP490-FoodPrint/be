import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const RegistrationRequest = sequelize.define(
  "RegistrationRequest",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    applicant_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    request_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    profile_data: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    supporting_documents: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    rejection_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    reviewed_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    submitted_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    reviewed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    }
  },
  {
    tableName: "registration_requests",
    schema: "foodprint",
    timestamps: true,
    createdAt: false,
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default RegistrationRequest
