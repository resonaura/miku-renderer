import { execSync } from "child_process";

// Парсим HH:MM:SS:FF где FF — кадры проекта, конвертируем в секунды проекта.
export function convertTimecodeToSeconds(
  tc: string,
  projectFps: number
): number {
  const m = tc.match(/^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`Invalid timecode: ${tc}`);
  const [, hh, mm, ss, ff] = m.map(Number) as unknown as number[];
  const base = hh * 3600 + mm * 60 + ss;
  if (ff >= projectFps)
    throw new Error(
      `Segment frame (FF:${ff}) is larger than available fps  (${projectFps}) in ${tc}`
    );
  return base + ff / projectFps;
}

export function convertSecondsToTime(tcSec: number): string {
  const hh = Math.floor(tcSec / 3600);
  const mm = Math.floor((tcSec % 3600) / 60);
  const ss = Math.floor(tcSec % 60);
  const ms = Math.round((tcSec - Math.floor(tcSec)) * 1000);
  const pad = (n: number, l = 2) => n.toString().padStart(l, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}.${pad(ms, 3)}`;
}

export function getSupportedHwAccels() {
  try {
    // Выводит список доступных hwaccel, например:
    //   Hardware acceleration methods:
    //     vdpau
    //     vaapi
    //     cuda
    //     qsv
    //     videotoolbox
    const out = execSync("ffmpeg -hide_banner -hwaccels").toString();
    return out
      .split("\n")
      .slice(1) // убираем заголовок
      .map((l) => l.trim()) // обрезаем пробелы
      .filter((l) => l); // оставляем непустые строки
  } catch (e) {
    return [];
  }
}

export function pickBestHwAccel(available) {
  const preferredOrder = [
    "cuda",         // NVIDIA
    "qsv",          // Intel QuickSync
    "vaapi",        // Linux VA-API
    "videotoolbox", // macOS
    "dxva2",        // Windows
    "d3d11va",      // Windows 10+
  ];
  return preferredOrder.find((p) => available.includes(p)) || null;
}