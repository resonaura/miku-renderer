import { spawn } from "child_process";
import { FFProbeFullResult, ProbeInfo } from "./types.js";

export async function ffprobe(file: string): Promise<ProbeInfo> {
  const cliArguments = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    file,
  ];

  const cliOutput = await execCapture("ffprobe", cliArguments);
  const result: FFProbeFullResult = JSON.parse(cliOutput);

  const streams = result.streams || [];

  const videoStreams = streams.find((s: any) => s.codec_type === "video");
  const audioStreams = streams.find((s: any) => s.codec_type === "audio");

  let fps: number | undefined;

  if (videoStreams?.r_frame_rate && videoStreams.r_frame_rate !== "0/0") {
    const [num, den] = videoStreams.r_frame_rate
      .split("/")
      .map((x: string) => parseFloat(x));
    if (den) fps = num / den;
  }

  return {
    hasAudio: !!audioStreams,
    hasVideo: !!videoStreams,
    durationSec: parseFloat(result.format?.duration ?? "0") || undefined,
    videoFps: fps,
    audioSampleRate: audioStreams
      ? parseInt(audioStreams.sample_rate.toString(), 10)
      : undefined,
  };
}

async function execCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const _process = spawn(command, args);
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];

    _process.stdout.on("data", (d) => chunks.push(d));
    _process.stderr.on("data", (d) => errors.push(d));
    _process.on("error", reject);
    _process.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else
        reject(
          new Error(Buffer.concat(errors).toString("utf8") || `code ${code}`)
        );
    });
  });
}
