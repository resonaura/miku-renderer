import { FFProbeResult } from "ffprobe";

// Время HH:MM:SS:FF (FF — кадры проекта)
export type Timecode = string;

export interface Resolution {
  width: number;
  height: number;
}
export type ContainerFormat = "mp4" | "mov" | "mkv" | "webm";

/* ---------- transitions ---------- */
export interface Transition {
  /** длительность в секундах (>=0.001) */
  duration: number;
  /** тип. Пока один — crossfade. Можно расширять. */
  type?: "crossfade" | "default";
}

export interface TransitionsBlock {
  /** появление клипа */
  in?: Transition;
  /** уход клипа */
  out?: Transition;
}

/* ---------- базовые клипы ---------- */
export interface BaseClip {
  start: Timecode;
  end: Timecode;
  type: "video" | "image" | "audio";
  filename: string;
}

export interface VideoClip extends BaseClip {
  type: "video";
  offset?: Timecode;
  speed?: number;
  volume?: number;
  transitions?: TransitionsBlock;
}

export interface ImageClip extends BaseClip {
  type: "image";
  transitions?: TransitionsBlock;
}

export interface AudioClip extends BaseClip {
  type: "audio";
  volume?: number;
  offset?: Timecode;
}

export interface Timeline {
  video: (VideoClip | ImageClip)[];
  audio?: AudioClip[];
}

export interface Project {
  format?: ContainerFormat;
  resolution: Resolution;
  fps: number;
  timeline: Timeline;
}

export interface ProbeInfo {
  hasAudio: boolean;
  hasVideo: boolean;
  durationSec?: number;
  videoFps?: number;
  audioSampleRate?: number;
}

interface FormatTags {
  major_brand: string;
  minor_version: string;
  compatible_brands: string;
  comment: string;
  vid_md5: string;
  encoder: string;
}

interface Format {
  filename: string;
  nb_streams: number;
  nb_programs: number;
  nb_stream_groups: number;
  format_name: string;
  format_long_name: string;
  start_time: string;
  duration: string;
  size: string;
  bit_rate: string;
  probe_score: number;
  tags: FormatTags;
}

export interface FFProbeFullResult extends FFProbeResult {
  format: Format;
}
