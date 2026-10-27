import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    school_id: { type: DataTypes.UUID, allowNull: true },
    supplier_id: { type: DataTypes.UUID, allowNull: true },
    username: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    full_name: { type: DataTypes.STRING(150), allowNull: false },
    role: { type: DataTypes.STRING(80), allowNull: false },
    org_type: { type: DataTypes.STRING(30), allowNull: false },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "ACTIVE" },
  },
  { tableName: "users" }
)

export default User
