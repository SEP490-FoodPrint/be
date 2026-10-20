import { Sequelize } from "sequelize"
import dotenv from "dotenv"
dotenv.config()

const sequelize = new Sequelize(
  process.env.DB_NAME || "foodprint",
  process.env.DB_USER || "postgres",
  process.env.DB_PASS || "123",
  {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 5432,
    dialect: "postgres",
    logging: process.env.NODE_ENV === "development" ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: true,
      underscored: true,
    },
  }
)

export const connectDB = async () => {
  try {
    await sequelize.authenticate()
    console.log(`✅ Kết nối PostgreSQL thành công [Database: ${process.env.DB_NAME || "foodprint"}]`)
  } catch (error) {
    console.error("❌ Lỗi kết nối PostgreSQL:", error.message)
    console.log("👉 Gợi ý: Hãy kiểm tra PostgreSQL Server đã chạy và database 'foodprint' đã được tạo.")
  }
}

export default sequelize
