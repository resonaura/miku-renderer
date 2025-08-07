import { FastifyPluginAsync } from "fastify";
import { enqueueBuild } from "../queue/processor.js";
import { db } from "../config/index.js";

const videos: FastifyPluginAsync = async (f) => {
  f.post(
    "/build",
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
      const id = enqueueBuild(req.body);
      const task = db.getTask(id);
      return reply.send({ id, status: task.status });
    }
  );

  f.get("/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = db.getTask(id);
    if (!task) return reply.status(404).send({ error: "Not found" });
    return { id, status: task.status, step: task.step, retries: task.retries };
  });
};

export default videos;
