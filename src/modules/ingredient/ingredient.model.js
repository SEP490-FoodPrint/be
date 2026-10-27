import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const Ingredient = sequelize.define(
  "Ingredient",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    supplier_id: { type: DataTypes.UUID, allowNull: true },
    name: { type: DataTypes.STRING(180), allowNull: false },
    code: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    unit: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "kg" },
    allergen_code: { type: DataTypes.STRING(80), allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "ACTIVE" },
  },
  { tableName: "ingredients" }
)

export default Ingredient
