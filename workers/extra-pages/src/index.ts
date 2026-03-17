import { createWorker, shutdownWorkers, QUEUE_NAMES } from "@lead-gen/queue";
import type { ExtraPagesJobData, ExtraPagesJobResult } from "@lead-gen/queue";
import { processExtraPagesJob } from "./processor.js";

const worker = createWorker<ExtraPagesJobData, ExtraPagesJobResult>(
  {
    queueName: QUEUE_NAMES.EXTRA_PAGES,
    concurrency: 1, // AI generation is heavy — one at a time
  },
  processExtraPagesJob,
);

console.log("[extra-pages] Worker started, waiting for jobs...");

const shutdown = () => shutdownWorkers([worker]);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
