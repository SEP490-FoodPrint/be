import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const SchoolSupplierRelationship = sequelize.define(
  "SchoolSupplierRelationship",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    school_id: {
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
    linked_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    unlinked_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    suspended_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    link_note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    unlink_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    suspension_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    linked_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    unlinked_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    suspended_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    AND: {
      type: DataTypes.STRING(50),
      allowNull: false,
    }
  },
  {
    tableName: "school_supplier_relationships",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default SchoolSupplierRelationship
