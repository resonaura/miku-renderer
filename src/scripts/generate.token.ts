#!/usr/bin/env node
import crypto from "crypto";
import { db } from "../config/index.js";       // ваш импорт Database
import dotenv from "dotenv";
dotenv.config();

if (!process.env.TOKEN_SECRET) {
  console.error("❌ TOKEN_SECRET не задан в окружении");
  process.exit(1);
}

// 1) Генерируем «сырое» значение токена
const rawToken = crypto.randomBytes(32).toString("hex");

// 2) Вычисляем HMAC-SHA256 (однонаправленный)
const tokenHash = crypto
  .createHmac("sha256", process.env.TOKEN_SECRET)
  .update(rawToken)
  .digest("hex");

// 3) Сохраняем хэш в БД
db.createToken(tokenHash);

// 4) Отдаём вам только «сырое» значение
console.log("✅ Generated token:", rawToken);
