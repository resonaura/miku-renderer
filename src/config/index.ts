import dotenv from "dotenv";
import { ensureDir } from "../utils/fs.js";
import { z } from "zod";
import path from "path";
import { Database } from "../database/index.js";
dotenv.config();

export const envSchema = z.object({
  TOKEN_SECRET: z.string().min(32),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  PORT: z.coerce.number().default(4224),
  APP_PUBLIC_URL: z.string().url().default("https://localhost:4224"),
  QUEUE_CONCURRENCY: z.coerce.number().default(3),
  RETRY_COUNT: z.coerce.number().default(3),
  STORAGE_DIR: z.string().default("storage"),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  // …другие переменные по необходимости
});

export type Env = z.infer<typeof envSchema>;
export const env = envSchema.parse(process.env);

// создаём storage/* папки
await ensureDir(env.STORAGE_DIR);
await ensureDir(path.join(env.STORAGE_DIR, "tmp"));
await ensureDir(path.join(env.STORAGE_DIR, "outputs"));
await ensureDir(path.join(env.STORAGE_DIR, "backups"));

export const storageDir = path.resolve(env.STORAGE_DIR);

export const db = new Database();
