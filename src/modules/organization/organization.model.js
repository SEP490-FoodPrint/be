import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

export const School = sequelize.define(
  "School",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: { type: DataTypes.STRING(180), allowNull: false },
    code: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    address: { type: DataTypes.STRING(300), allowNull: true },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "ACTIVE" },
  },
  { tableName: "schools" }
)

export const Supplier = sequelize.define(
  "Supplier",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: { type: DataTypes.STRING(180), allowNull: false },
    code: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    contract_number: { type: DataTypes.STRING(100), allowNull: true },
    food_safety_registration: { type: DataTypes.STRING(100), allowNull: true },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "ACTIVE" },
  },
  { tableName: "suppliers" }
)

export default { School, Supplier }
