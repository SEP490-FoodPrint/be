import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const SupplierCertification = sequelize.define(
  "SupplierCertification",
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
    certification_type: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    certificate_no: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    issued_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    expiry_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    document_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    }
  },
  {
    tableName: "supplier_certifications",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default SupplierCertification
