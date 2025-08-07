import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import path from "path";
import fs from "fs/promises";
import { db, env, storageDir } from "../config/index.js";
import { queue } from "./index.js";
import { buildFFmpegCommand } from "../graph.js";
import { normalizeProject } from "../validate.js";
import { Project } from "../types.js";
import { ensureDir } from "../utils/fs.js";

export function enqueueBuild(json: any): string {
  const taskId = uuid();
  db.createTask(taskId);
  queue.add(() => runBuild(taskId, json));
  return taskId;
}

async function runBuild(taskId: string, json: any) {
  const maxRetries = env.RETRY_COUNT;
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      attempt++;
      db.updateTask(taskId, "processing", `packing-inputs (try ${attempt})`);
      // создаём tmp‐директорию
      const tmp = path.join(storageDir, "tmp", taskId);
      await ensureDir(tmp);
      const inputJson = path.join(tmp, "input.json");
      await fs.writeFile(inputJson, JSON.stringify(json));

      const raw = await fs.readFile(inputJson, "utf8");
      const project = JSON.parse(raw) as Project;
      const normalized = normalizeProject(project);
      // запускаем ffmpeg через ваш buildFFmpegCommand + render
      const result = await buildFFmpegCommand(
        normalized,
        project,
        inputJson,
        path.join(storageDir, "outputs", `${taskId}.mp4`)
      );
      const ffArgs = result.ffArgs;
      const proc = spawn(env.FFMPEG_PATH, ffArgs);
      proc.stdout.on("data", (d) => console.log(`🔊 ${d}`));
      proc.stderr.on("data", (d) => console.error(`❗ ${d}`));
      await new Promise((res, rej) =>
        proc.on("close", (code) =>
          code === 0 ? res(0) : rej(new Error(`code ${code}`))
        )
      );
      db.updateTask(taskId, "success");
      console.log(`✅ Task ${taskId} done`);
      return;
    } catch (e) {
      const retries = db.incrementRetries(taskId);
      console.warn(
        `⚠️ Task ${taskId} failed on attempt ${attempt}: ${e.message}`
      );
      if (retries > maxRetries) {
        db.updateTask(taskId, "failed", e.message);
        return;
      }
      // пауза перед retry
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
