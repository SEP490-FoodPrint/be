import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const Role = sequelize.define(
  "Role",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    code: {
      type: DataTypes.STRING(60),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    }
  },
  {
    tableName: "roles",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    underscored: true,
  }
)

export default Role
