import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const SourceFacility = sequelize.define(
  "SourceFacility",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    supplier_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    facility_code: {
      type: DataTypes.STRING(80),
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    contact_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    contact_phone: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    contact_email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    is_visible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
    created_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    updated_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    }
  },
  {
    tableName: "source_facilities",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default SourceFacility
