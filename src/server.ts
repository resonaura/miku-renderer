import path from "path";
import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import { env, storageDir, db } from "./config/index.js";
import videosRoutes from "./routes/video.js";

export async function bootstrap(): Promise<void> {
  const app = Fastify({ logger: true });

  // 1) Статика «outputs» без авторизации
  app.register(staticPlugin, {
    root: path.join(storageDir, "outputs"),
    prefix: "/outputs/",
  });

  // 2) Хук проверки токена на всё остальное
  app.addHook("onRequest", async (request, reply) => {
    const auth = request.headers.authorization;
    const rawToken =
      typeof auth === "string" && auth.startsWith("Bearer ")
        ? auth.slice(7)
        : null;

    if (!rawToken || !db.isValidToken(rawToken)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });

  // 3) Защищённые маршруты
  app.register(videosRoutes, { prefix: "/api/videos" });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`🚀 Server ready at ${env.APP_PUBLIC_URL}`);
}