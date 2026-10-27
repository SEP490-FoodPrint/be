import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const MenuDay = sequelize.define(
  "MenuDay",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    weekly_menu_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    menu_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    }
  },
  {
    tableName: "menu_days",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default MenuDay
