import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const Class = sequelize.define(
  "Class",
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
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    academic_year: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    registered_meal_portions: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    }
  },
  {
    tableName: "classes",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default Class
