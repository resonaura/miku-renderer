# 🎬 Miku Renderer

[![Version](https://img.shields.io/badge/Version-1.0.0-blue.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white)](package.json)
[![Engine](https://img.shields.io/badge/Engine-FFmpeg%20%7C%20Fastify-007808.svg?logo=ffmpeg&logoColor=white)](src/graph.ts)
[![Queue](https://img.shields.io/badge/Queue-SQLite%20%7C%20P--Queue-003B57.svg?logo=sqlite&logoColor=white)](src/queue)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/resonaura)

A declarative, high-performance Node.js & FFmpeg video rendering engine. Takes structured JSON timelines and programmatically renders multi-track video compositions with transitions, audio balancing, overlays, and queue concurrency.

---

## ✨ Key Advantages & Features

- 📜 **Declarative JSON Timelines**: Define complex video edits, cut points, asset offsets, and volume parameters as simple, portable JSON schemas.
- 🔀 **Complex Filtergraph Generation**: Automatically builds optimized FFmpeg complex filtergraphs (`-filter_complex`) on the fly, handling framerate normalization, scaling, padding, crossfades, and audio mixing.
- ⚡ **REST API & CLI Interfaces**: Run ad-hoc render jobs straight from your terminal via `src/cli.ts`, or deploy as a Fastify HTTP rendering microservice.
- 🚦 **Embedded Task Queue**: Built-in SQLite job ledger and concurrency management via `p-queue` — prevents CPU/GPU throttling and ensures rock-solid execution under load.
- 🎵 **Multi-Track Audio & Transitions**: Supports independent video and audio tracks, speed manipulation, in/out cross-dissolves, and ducking.

---

## 🚀 Getting Started

### Prerequisites

- Node.js >= 20
- FFmpeg and FFprobe installed and accessible in your `PATH`

### Installation

```bash
npm install
npm run build
```

### CLI Rendering Example

```bash
# Render example composition
npm run render
```

### Starting the HTTP Service

```bash
npm start
```
