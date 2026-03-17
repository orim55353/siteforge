import { createWorker, shutdownWorkers, QUEUE_NAMES } from "@lead-gen/queue";
import type { SchedulerJobData, SchedulerJobResult } from "@lead-gen/queue";
import { processSchedulerJob } from "./processor.js";

const worker = createWorker<SchedulerJobData, SchedulerJobResult>(
  {
    queueName: QUEUE_NAMES.SCHEDULER,
    concurrency: 5,
  },
  processSchedulerJob,
);

console.log("[scheduler] Worker started, waiting for jobs...");

const shutdown = () => shutdownWorkers([worker]);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
