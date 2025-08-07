import { NormalizedProject } from "./validate.js";
import { VideoClip, ImageClip, Transition, Project } from "./types.js";
import {
  convertTimecodeToSeconds,
  getSupportedHwAccels,
  pickBestHwAccel,
} from "./utils.js";
import { ffprobe } from "./ffprobe.js";

type InputSpec = { args: string[]; describe: string };
interface BuildResult {
  ffArgs: string[];
}

const _hwAccel = (() => {
  const avail = getSupportedHwAccels();
  return pickBestHwAccel(avail);
})();

export async function buildFFmpegCommand(
  normalizedProject: NormalizedProject,
  project: Project,
  _json: string,
  outputPath: string
): Promise<BuildResult> {
  const { fps, width, height, videoClips, audioClips, totalDuration } =
    normalizedProject;

  // 0. Сегментация + гэпы
  type Segment = {
    kind: "clip" | "gap";
    start: number;
    end: number;
    clip?: VideoClip | ImageClip;
  };
  const segments: Segment[] = [];
  let cursor = 0;
  for (const clip of videoClips) {
    const start = convertTimecodeToSeconds(clip.start, fps);
    const end = convertTimecodeToSeconds(clip.end, fps);
    if (start > cursor) {
      segments.push({ kind: "gap", start: cursor, end: start });
    }
    segments.push({ kind: "clip", start, end, clip });
    cursor = end;
  }
  if (cursor < totalDuration) {
    segments.push({ kind: "gap", start: cursor, end: totalDuration });
  }

  // 1. Inputs и базовые метки
  const inputs: InputSpec[] = [];
  const filters: string[] = [];
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];
  const segDur: number[] = [];
  let nextInputIndex = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const dur = +(seg.end - seg.start).toFixed(6);
    segDur[i] = dur;

    if (seg.kind === "gap") {
      // Видео-гэп
      inputs.push({
        args: [
          "-f",
          "lavfi",
          "-t",
          dur.toString(),
          "-i",
          `color=c=black:s=${width}x${height}:r=${fps}`,
        ],
        describe: `gapV_${i}`,
      });
      // Аудио-гэп
      inputs.push({
        args: [
          "-f",
          "lavfi",
          "-t",
          dur.toString(),
          "-i",
          "anullsrc=r=48000:cl=stereo",
        ],
        describe: `gapA_${i}`,
      });

      const vIn = `[${nextInputIndex}:v]`;
      const aIn = `[${nextInputIndex + 1}:a]`;
      nextInputIndex += 2;

      const vLab = `sv${i}`;
      const aLab = `sa${i}`;
      filters.push(`${vIn}fps=${fps},setsar=1[${vLab}]`);
      filters.push(`${aIn}atrim=0:${dur},asetpts=PTS-STARTPTS[${aLab}]`);

      videoLabels[i] = `[${vLab}]`;
      audioLabels[i] = `[${aLab}]`;
      continue;
    }

    // Клип (image/video)
    const c = seg.clip!;

    if (c.type === "image") {
      // Изображение
      inputs.push({
        args: ["-loop", "1", "-t", dur.toString(), "-i", c.filename],
        describe: `imgV_${i}`,
      });
      const imgIn = nextInputIndex++;
      inputs.push({
        args: [
          "-f",
          "lavfi",
          "-t",
          dur.toString(),
          "-i",
          "anullsrc=r=48000:cl=stereo",
        ],
        describe: `imgA_${i}`,
      });
      const silIn = nextInputIndex++;

      const vIn = `[${imgIn}:v]`;
      const aIn = `[${silIn}:a]`;
      const vLab = `sv${i}`;
      const aLab = `sa${i}`;

      filters.push(
        `${vIn}` +
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
          `fps=${fps},setsar=1[${vLab}]`
      );
      filters.push(`${aIn}atrim=0:${dur},asetpts=PTS-STARTPTS[${aLab}]`);

      applyClipFades(i, c, dur, filters);

      videoLabels[i] = `[${vLab}]`;
      audioLabels[i] = `[${aLab}]`;
      continue;
    }

    // Видео-файл
    inputs.push({ args: ["-i", c.filename], describe: `vidV_${i}` });
    const vidIn = nextInputIndex++;
    const vIn = `[${vidIn}:v]`;
    const aIn = `[${vidIn}:a]`;
    const vLab = `sv${i}`;
    const aLab = `sa${i}`;

    const off = c.offset ? convertTimecodeToSeconds(c.offset, fps) : 0;
    const speed = c.speed ?? 1;
    const srcLen = dur * speed;
    const ptsExpr = speed !== 1 ? `,setpts=PTS/${speed}` : "";

    filters.push(
      `${vIn}trim=start=${off}:end=${
        off + srcLen
      },setpts=PTS-STARTPTS${ptsExpr},` +
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `fps=${fps},setsar=1[${vLab}]`
    );

    const probe = await ffprobe(c.filename);
    if (probe.hasAudio) {
      filters.push(
        `${aIn}atrim=start=${off}:end=${off + srcLen},` +
          `asetpts=PTS-STARTPTS${buildAtempoChain(speed)},volume=${
            c.volume ?? 1
          }[${aLab}]`
      );
    } else {
      inputs.push({
        args: [
          "-f",
          "lavfi",
          "-t",
          dur.toString(),
          "-i",
          "anullsrc=r=48000:cl=stereo",
        ],
        describe: `silA_${i}`,
      });
      const silIn2 = nextInputIndex++;
      filters.push(`[${silIn2}:a]atrim=0:${dur},asetpts=PTS-STARTPTS[${aLab}]`);
    }

    applyClipFades(i, c, dur, filters);

    videoLabels[i] = `[${vLab}]`;
    audioLabels[i] = `[${aLab}]`;
  }

  // 2. Cross-fade только для пар клипов с одинаковым duration
  for (let i = 0; i < segments.length - 1; i++) {
    const segA = segments[i],
      segB = segments[i + 1];
    if (segA.kind !== "clip" || segB.kind !== "clip") continue;

    const outT = segA.clip!.transitions?.out;
    const inT = segB.clip!.transitions?.in;
    if (!isXfadePair(outT, inT)) continue;
    const d = outT!.duration;

    // Видео
    const curV = videoLabels[i],
      nxtV = videoLabels[i + 1];
    filters.push(`${curV}trim=end=${segDur[i]}[v${i}m]`);
    filters.push(
      `${nxtV}trim=start=0:end=${d},setpts=PTS-STARTPTS[v${i + 1}h]`
    );
    filters.push(
      `[v${i}m][v${i + 1}h]xfade=transition=fade:duration=${d}:offset=${
        segDur[i] - d
      }[vxf${i}]`
    );
    filters.push(`${nxtV}trim=start=${d},setpts=PTS-STARTPTS[v${i + 1}r]`);
    videoLabels[i] = `[vxf${i}]`;
    videoLabels[i + 1] = `[v${i + 1}r]`;

    // Аудио
    const curA = audioLabels[i],
      nxtA = audioLabels[i + 1];
    filters.push(`${curA}atrim=end=${segDur[i]}[a${i}m]`);
    filters.push(
      `${nxtA}atrim=start=0:end=${d},asetpts=PTS-STARTPTS[a${i + 1}h]`
    );
    filters.push(`[a${i}m][a${i + 1}h]acrossfade=d=${d}[axf${i}]`);
    filters.push(`${nxtA}atrim=start=${d},asetpts=PTS-STARTPTS[a${i + 1}r]`);
    audioLabels[i] = `[axf${i}]`;
    audioLabels[i + 1] = `[a${i + 1}r]`;
  }

  // 3. Конкат всех сегментов
  const concatInputs: string[] = [];
  for (let i = 0; i < videoLabels.length; i++) {
    concatInputs.push(videoLabels[i], audioLabels[i]);
  }
  filters.push(
    `${concatInputs.join("")}concat=n=${videoLabels.length}:v=1:a=1[Vcat][Aout]`
  );

  // 4. Оверлей дополнительного аудио
  const oLabs: string[] = [];
  let overlayIndex = nextInputIndex;
  for (let k = 0; k < audioClips.length; k++) {
    const ac = audioClips[k];
    const s = convertTimecodeToSeconds(ac.start, fps);
    const e = convertTimecodeToSeconds(ac.end, fps);
    const d = +(e - s).toFixed(6);

    inputs.push({ args: ["-i", ac.filename], describe: `ovA_${k}` });
    filters.push(
      `[${overlayIndex}:a]atrim=0:${d},asetpts=PTS-STARTPTS,adelay=${Math.round(
        s * 1000
      )}|${Math.round(s * 1000)},volume=${
        ac.volume ?? 1
      },aformat=sample_rates=48000:channel_layouts=stereo[ov${k}]`
    );
    oLabs.push(`[ov${k}]`);
    overlayIndex++;
  }

  // 5. Финальный микс аудио
  filters.push(`[Aout]aformat=sample_rates=48000:channel_layouts=stereo[Aud]`);
  if (oLabs.length) {
    filters.push(
      `[Aud]${oLabs.join("")}amix=inputs=${
        oLabs.length + 1
      }:normalize=1:duration=longest[Afinal]`
    );
  } else {
    filters.push(`[Aud]asplit=1[Afinal]`);
  }

  // 6. Собираем ffmpeg args
  const ffArgs: string[] = ["-y"];

  // if (_hwAccel) {
  //   ffArgs.push("-hwaccel", _hwAccel);
  //   if (_hwAccel === "cuda") {
  //     ffArgs.push("-hwaccel_output_format", "cuda");
  //   } else if (_hwAccel === "qsv") {
  //     // чтобы FFmpeg сразу выбрал QSV-декодер
  //     ffArgs.push("-c:v", "h264_qsv");
  //   }
  // }

  for (const inp of inputs) {
    ffArgs.push(...inp.args);
  }
  ffArgs.push("-filter_complex", filters.join(";"));
  ffArgs.push("-map", "[Vcat]", "-map", "[Afinal]");
  ffArgs.push("-t", totalDuration.toFixed(6));

  if (_hwAccel === "cuda") {
    ffArgs.push("-c:v", "h264_nvenc", "-rc", "vbr_hq", "-cq", "16");
  } else if (_hwAccel === "qsv") {
    ffArgs.push("-c:v", "h264_qsv", "-global_quality", "23");
  } else {
    ffArgs.push("-c:v", "libx264", "-preset", "veryslow", "-crf", "16");
  }
  // далее без изменений:
  ffArgs.push(
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "320k",
    "-movflags",
    "+faststart",
    "-s",
    `${width}x${height}`,
    "-f",
    project.format ?? "mp4",
    outputPath
  );

  return { ffArgs };
}

function applyClipFades(
  i: number,
  clip: VideoClip | ImageClip,
  dur: number,
  filters: string[]
) {
  const tr = clip.transitions ?? {};
  const vLab = `sv${i}`;
  const aLab = `sa${i}`;

  if (tr.in && tr.in.type !== "crossfade") {
    const dIn = Math.min(tr.in.duration, dur);
    filters.push(
      `[${vLab}]fade=t=in:st=0:d=${dIn}[${vLab}]`,
      `[${aLab}]afade=t=in:st=0:d=${dIn}[${aLab}]`
    );
  }
  if (tr.out && tr.out.type !== "crossfade") {
    const dOut = Math.min(tr.out.duration, dur);
    const stOut = Math.max(0, dur - dOut);
    filters.push(
      `[${vLab}]fade=t=out:st=${stOut}:d=${dOut}[${vLab}]`,
      `[${aLab}]afade=t=out:st=${stOut}:d=${dOut}[${aLab}]`
    );
  }
}

function isXfadePair(tOut?: Transition, tIn?: Transition) {
  return (
    !!tOut &&
    !!tIn &&
    tOut.type === "crossfade" &&
    tIn.type === "crossfade" &&
    Math.abs(tOut.duration - tIn.duration) < 1e-3 &&
    tOut.duration > 0
  );
}

function buildAtempoChain(speed: number): string {
  if (speed === 1) return "";
  const parts: number[] = [];
  let s = speed;
  while (s > 2) {
    parts.push(2);
    s /= 2;
  }
  while (s < 0.5) {
    parts.push(0.5);
    s *= 2;
  }
  parts.push(s);
  return parts.map((v) => `,atempo=${v.toFixed(6)}`).join("");
}
