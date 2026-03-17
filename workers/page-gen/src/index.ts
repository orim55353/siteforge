import { createWorker, shutdownWorkers, QUEUE_NAMES } from "@lead-gen/queue";
import type { PageGenJobData, PageGenJobResult } from "@lead-gen/queue";
import { processPageGenJob } from "./processor.js";

const worker = createWorker<PageGenJobData, PageGenJobResult>(
  {
    queueName: QUEUE_NAMES.PAGE_GEN,
    concurrency: 3,
  },
  processPageGenJob,
);

console.log("[page-gen] Worker started, waiting for jobs...");

const shutdown = () => shutdownWorkers([worker]);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
