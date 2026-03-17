import { createWorker, shutdownWorkers, QUEUE_NAMES } from "@lead-gen/queue";
import type { EmailJobData, EmailJobResult } from "@lead-gen/queue";
import { processEmailJob } from "./processor.js";

const worker = createWorker<EmailJobData, EmailJobResult>(
  {
    queueName: QUEUE_NAMES.EMAIL,
    concurrency: 5,
  },
  processEmailJob,
);

console.log("[email] Worker started, waiting for jobs...");

const shutdown = () => shutdownWorkers([worker]);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
