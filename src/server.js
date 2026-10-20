import app from "./app.js"
import { connectDB } from "./config/database.js"
import dotenv from "dotenv"

dotenv.config()

const PORT = process.env.PORT || 5000

const startServer = async () => {
  // 1. Kiểm tra kết nối PostgreSQL
  await connectDB()

  // 2. Khởi chạy HTTP Server
  app.listen(PORT, () => {
    console.log(`🚀 FoodPrint Backend đang chạy tại: http://localhost:${PORT}`)
    console.log(`📡 Health check endpoint: http://localhost:${PORT}/api/health`)
  })
}

startServer()
