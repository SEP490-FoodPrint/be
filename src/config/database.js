import { Sequelize } from "sequelize"
import dotenv from "dotenv"
dotenv.config()

const isAzureOrSsl =
  process.env.DB_SSL === "true" ||
  (process.env.DB_HOST && process.env.DB_HOST.includes("azure.com"))

const sequelize = new Sequelize(
  process.env.DB_NAME || "foodprint",
  process.env.DB_USER || "postgres",
  process.env.DB_PASSWORD || process.env.DB_PASS || "123",
  {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 5432,
    dialect: "postgres",
    dialectOptions: isAzureOrSsl
      ? {
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
        }
      : {},
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
      ...(process.env.DB_SCHEMA ? { schema: process.env.DB_SCHEMA } : {}),
    },
  }
)

export const connectDB = async () => {
  try {
    await sequelize.authenticate()
    console.log(`✅ Kết nối PostgreSQL thành công [Database: ${process.env.DB_NAME || "foodprint"}]`)
  } catch (error) {
    console.error("❌ Lỗi kết nối PostgreSQL:", error.message)
    console.log("👉 Gợi ý: Kiểm tra Firewall rules trên Azure, thông tin đăng nhập trong file .env và trạng thái Azure Database.")
  }
}

export default sequelize
