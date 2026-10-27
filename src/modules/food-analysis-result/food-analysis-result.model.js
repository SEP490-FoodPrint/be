import { DataTypes } from "sequelize"
import sequelize from "../../config/database.js"

const FoodAnalysisResult = sequelize.define(
  "FoodAnalysisResult",
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    incident_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    ingredient_lot_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    retained_food_sample_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    laboratory_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    report_number: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    test_type: {
      type: DataTypes.STRING(160),
      allowNull: true,
    },
    sample_description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    sampled_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    tested_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    result_summary: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    document_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    recorded_by_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    ingredient_lot_id: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    OR: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    OR: {
      type: DataTypes.STRING(50),
      allowNull: false,
    }
  },
  {
    tableName: "food_analysis_results",
    schema: "foodprint",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    underscored: true,
  }
)

export default FoodAnalysisResult
