import PQueue from "p-queue";
import { env } from "../config/index.js";

export const queue = new PQueue({ concurrency: env.QUEUE_CONCURRENCY });
