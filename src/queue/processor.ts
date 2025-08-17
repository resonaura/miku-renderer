// ⬆️ существующие импорты
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

// ➕ NEW:
import { EventEmitter } from "node:events";
export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(0); // без лимитов на слушателей

export function enqueueBuild(json: any): string {
  const taskId = uuid();
  db.createTask(taskId);
  queue.add(() => runBuild(taskId, json));
  return taskId;
}

// ➕ helper для безопасной отправки SSE-сообщений
function emitUpdate(id: string, payload: any) {
  try {
    taskEvents.emit(id, { id, ...payload });
  } catch {}
}

async function runBuild(taskId: string, json: any) {
  const maxRetries = env.RETRY_COUNT;
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      attempt++;

      // ── preparing ─────────────────────────────────────────────
      const stepPrep = `preparing-inputs (try ${attempt})`;
      db.updateTask(taskId, "processing", stepPrep);
      emitUpdate(taskId, {
        type: "status",
        status: "processing",
        phase: "preparing",
        step: stepPrep,
        progress: 0,
      });

      // создаём tmp‐директорию
      const tmp = path.join(storageDir, "tmp", taskId);
      await ensureDir(tmp);
      const inputJson = path.join(tmp, "input.json");
      await fs.writeFile(inputJson, JSON.stringify(json));

      // ── validate & graph ─────────────────────────────────────
      const raw = await fs.readFile(inputJson, "utf8");
      const project = JSON.parse(raw) as Project;
      const normalized = normalizeProject(project);

      db.updateTask(taskId, "processing", "building-graph");
      emitUpdate(taskId, {
        type: "status",
        status: "processing",
        phase: "preparing",
        step: "building-graph",
        progress: 0,
      });

      const outFile = path.join(storageDir, "outputs", `${taskId}.mp4`);
      const result = await buildFFmpegCommand(
        normalized,
        project,
        inputJson,
        outFile
      );
      const ffArgs = result.ffArgs;

      // ── spawn ffmpeg c прогрессом ────────────────────────────
      // progress в stdout в формате key=value
      const ffArgsWithProgress = [...ffArgs, "-progress", "pipe:1", "-nostats"];
      const proc = spawn(env.FFMPEG_PATH, ffArgsWithProgress);

      db.updateTask(taskId, "processing", "rendering");
      emitUpdate(taskId, {
        type: "status",
        status: "processing",
        phase: "rendering",
        step: "rendering",
        progress: 0,
      });

      // буферы и парсинг progress
      let buf = "";
      const total = normalized.totalDuration || 0;
      let lastEmit = 0;

      proc.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || ""; // хвост приберегли

        // собираем ключ-значение за "сессию" до progress=...
        let snap: Record<string, string> = {};
        for (const line of lines) {
          const m = line.match(/^([^=\s]+)=(.*)$/);
          if (!m) continue;
          const [, k, v] = m;
          snap[k] = v;

          if (k === "progress") {
            // готова "порция" данных
            const outMs = Number(snap["out_time_ms"] || "0");
            const outTime = outMs ? outMs / 1_000_000 : 0;
            const fps = Number(snap["fps"] || "0");
            const speedStr = (snap["speed"] || "0x").replace("x", "");
            const speed = Number(speedStr) || 0;

            const cur = Math.min(outTime, total || outTime);
            const pct = total > 0 ? Math.max(0, Math.min(1, cur / total)) : 0;

            // простая оценка ETA (сек) по скорости ffmpeg
            const remain = total > 0 ? Math.max(0, total - cur) : 0;
            const etaSec = speed > 0 ? remain / speed : undefined;

            // троттлим эмиты до ~10/сек
            const now = Date.now();
            if (now - lastEmit > 100) {
              db.updateTask(
                taskId,
                "processing",
                `rendering ${Math.round(pct * 100)}%`
              );
              emitUpdate(taskId, {
                type: "progress",
                status: "processing",
                phase: "rendering",
                step: "rendering",
                progress: pct,
                timeSec: cur,
                fps,
                speed,
                etaSec,
              });
              lastEmit = now;
            }

            // конец прогресса — FFmpeg закончил
            if (snap["progress"] === "end") {
              // оставим закрытие в обработчике 'close'
            }

            // обнулим снепшот
            snap = {};
          }
        }
      });

      // полезные логи (если вдруг понадобятся)
      proc.stderr.on("data", (d) => {
        // Можно дополнительно анализировать stderr при желании
        // console.error(`❗ ${d}`);
      });

      await new Promise((res, rej) =>
        proc.on("close", (code) =>
          code === 0 ? res(0) : rej(new Error(`code ${code}`))
        )
      );

      // ── success ──────────────────────────────────────────────
      db.updateTask(taskId, "success", null);
      const url = `${env.APP_PUBLIC_URL}/outputs/${taskId}.mp4`;
      emitUpdate(taskId, {
        type: "done",
        status: "success",
        phase: "done",
        step: null,
        progress: 1,
        outputUrl: url,
        outputPath: outFile,
      });

      console.log(`✅ Task ${taskId} done`);
      return;
    } catch (e: any) {
      const retries = db.incrementRetries(taskId);
      const msg = e?.message || String(e);
      console.warn(`⚠️ Task ${taskId} failed on attempt ${attempt}: ${msg}`);

      emitUpdate(taskId, {
        type: "error",
        status: "failed",
        phase: "failed",
        step: "error",
        error: msg,
        attempt,
      });

      if (retries > maxRetries) {
        db.updateTask(taskId, "failed", msg);
        return;
      }
      // пауза перед retry
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
