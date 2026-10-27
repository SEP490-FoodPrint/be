import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const MenuReviewRecord = sequelize.define(
  "MenuReviewRecord",
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
    reviewer_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    decision: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    feedback: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    reviewed_at: {
      type: DataTypes.DATE,
      allowNull: false,
    }
  },
  {
    tableName: "menu_review_records",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    underscored: true,
  }
)

export default MenuReviewRecord
