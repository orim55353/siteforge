import { createWorker, shutdownWorkers, QUEUE_NAMES } from "@lead-gen/queue";
import type { ScoringJobData, ScoringJobResult } from "@lead-gen/queue";
import { processScoringJob } from "./processor.js";

const worker = createWorker<ScoringJobData, ScoringJobResult>(
  {
    queueName: QUEUE_NAMES.SCORING,
    concurrency: 10,
  },
  processScoringJob,
);

console.log("[scoring] Worker started, waiting for jobs...");

const shutdown = () => shutdownWorkers([worker]);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
