import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    role_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    school_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    supplier_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    commune_food_safety_unit_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    username: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    password_hash: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    full_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    email_verified_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    last_login_at: {
      type: DataTypes.DATE,
      allowNull: true,
    }
  },
  {
    tableName: "users",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default User
