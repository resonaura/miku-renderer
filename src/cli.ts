import "./config/index.js";
import fs from "fs";
import { Project } from "./types.js";
import { normalizeProject } from "./validate.js";
import { buildFFmpegCommand } from "./graph.js";
import { spawn } from "child_process";

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn("ffmpeg", args, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

async function main() {
  const input = process.argv[2] ?? "input.example.json";
  const output = process.argv[3] ?? "output.mp4";
  if (!fs.existsSync(input)) throw new Error(`File not found: ${input}`);

  const project: Project = JSON.parse(fs.readFileSync(input, "utf8"));
  const normalized = normalizeProject(project);

  const { ffArgs } = await buildFFmpegCommand(
    normalized,
    project,
    input,
    output
  );

  console.log(
    "ffmpeg",
    ffArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")
  );

  await runFfmpeg(ffArgs);
  console.log(`✅ Video ready: ${output}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
