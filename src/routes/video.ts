import { FastifyPluginAsync } from "fastify";
import { enqueueBuild } from "../queue/processor.js";
import { db, env } from "../config/index.js";
// ➕ NEW:
import { taskEvents } from "../queue/processor.js";

const videos: FastifyPluginAsync = async (f) => {
  f.post(
    "/render",
    {
      schema: {
        body: { type: "object" /* тут JSON‐схема вашего Project */ },
        response: {
          200: {
            type: "object",
            properties: { id: { type: "string" }, status: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      // Если клиент хочет SSE — стримим прямо в ответ на render:
      const wantsSSE =
        typeof req.headers.accept === "string" &&
        req.headers.accept.includes("text/event-stream");

      const id = enqueueBuild(req.body);

      if (wantsSSE) {
        // ── SSE заголовки ─────────────────────
        reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
        reply.raw.setHeader("Connection", "keep-alive");
        // выключить буферизацию на прокси/нгинкс, если есть
        reply.raw.setHeader("X-Accel-Buffering", "no");

        // helper для отправки SSE пакетов
        const send = (event: string, data: any) => {
          reply.raw.write(`event: ${event}\n`);
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // initial
        const task = db.getTask(id)!;
        send("init", { id, status: task.status });

        // heartbeat, чтобы соединение не засыпало
        const heartbeat = setInterval(
          () => reply.raw.write(": ping\n\n"),
          15000
        );

        const listener = (payload: any) => {
          // маршрутизируем по type
          const ev =
            payload?.type === "progress"
              ? "progress"
              : payload?.type === "done"
              ? "done"
              : payload?.type === "error"
              ? "error"
              : "update";
          send(ev, payload);

          // авто-закрытие по done/error
          if (ev === "done" || ev === "error") {
            clearInterval(heartbeat);
            reply.raw.end();
          }
        };

        taskEvents.on(id, listener);

        // очистка при разрыве соединения
        const cleanup = () => {
          clearInterval(heartbeat);
          taskEvents.off(id, listener);
        };
        reply.raw.on("close", cleanup);
        reply.raw.on("error", cleanup);

        return reply; // важно вернуть reply, поток остаётся открытым
      }

      // Обычный JSON ответ (без SSE)
      const task = db.getTask(id)!;
      return reply.send({ id, status: task.status });
    }
  );

  // Резервный SSE-эндпоинт под EventSource (GET):
  f.get("/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = db.getTask(id);
    if (!task) return reply.status(404).send({ error: "Not found" });

    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");

    const send = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // отдадим текущее состояние
    send("init", {
      id,
      status: task.status,
      step: task.step,
      retries: task.retries,
    });

    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15000);

    const listener = (payload: any) => {
      const ev =
        payload?.type === "progress"
          ? "progress"
          : payload?.type === "done"
          ? "done"
          : payload?.type === "error"
          ? "error"
          : "update";
      send(ev, payload);
      if (ev === "done" || ev === "error") {
        clearInterval(heartbeat);
        reply.raw.end();
      }
    };

    taskEvents.on(id, listener);

    const cleanup = () => {
      clearInterval(heartbeat);
      taskEvents.off(id, listener);
    };
    reply.raw.on("close", cleanup);
    reply.raw.on("error", cleanup);

    return reply;
  });

  // Уже был: статусы по поллингу
  f.get("/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = db.getTask(id);
    if (!task) return reply.status(404).send({ error: "Not found" });
    return { id, status: task.status, step: task.step, retries: task.retries };
  });
};

export default videos;
