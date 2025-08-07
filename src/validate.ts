import { Project, VideoClip, ImageClip, AudioClip } from "./types.js";
import { convertTimecodeToSeconds } from "./utils.js";

export interface NormalizedProject {
  fps: number;
  width: number;
  height: number;
  format: string;
  videoClips: (VideoClip | ImageClip)[];
  audioClips: AudioClip[];
  totalDuration: number; // сек, длина проекта (максимум по всем дорожкам)
}

export function normalizeProject(p: Project): NormalizedProject {
  if (!p.fps || p.fps <= 0)
    throw new Error("Project fps is empty or incorrect");

  if (!p.resolution?.width || !p.resolution?.height) {
    throw new Error("Project resolution is required");
  }

  const fps = p.fps;
  const format = p.format ?? "mp4";

  const videoClips = [...(p.timeline.video ?? [])].sort(
    (a, b) => timecodeToSeconds(a.start) - timecodeToSeconds(b.start)
  );
  const audioClips = [...(p.timeline.audio ?? [])].sort(
    (a, b) => timecodeToSeconds(a.start) - timecodeToSeconds(b.start)
  );

  // запрет перекрытий на одной дорожке
  ensureNoOverlap(
    videoClips.map((c) => ({
      s: timecodeToSeconds(c.start),
      e: timecodeToSeconds(c.end),
    })),
    "video"
  );
  ensureNoOverlap(
    audioClips.map((c) => ({
      s: timecodeToSeconds(c.start),
      e: timecodeToSeconds(c.end),
    })),
    "audio"
  );

  const totalVideoEnd = videoClips.reduce(
    (m, c) => Math.max(m, timecodeToSeconds(c.end)),
    0
  );
  const totalAudioEnd = audioClips.reduce(
    (m, c) => Math.max(m, timecodeToSeconds(c.end)),
    0
  );

  const totalDuration = Math.max(totalVideoEnd, totalAudioEnd);

  return {
    fps,
    width: p.resolution.width,
    height: p.resolution.height,
    format: format,
    videoClips,
    audioClips,
    totalDuration,
  };

  function timecodeToSeconds(t: string) {
    return convertTimecodeToSeconds(t, fps);
  }
}

function ensureNoOverlap(spans: { s: number; e: number }[], label: string) {
  for (let i = 0; i < spans.length; i++) {
    if (spans[i].e <= spans[i].s)
      throw new Error(`${label}: end <= start on clip ${i}`);
    if (i > 0 && spans[i].s < spans[i - 1].e) {
      throw new Error(`${label}: found clips overlap on ${i - 1} and ${i}`);
    }
  }
}
