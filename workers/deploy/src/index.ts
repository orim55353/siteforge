import { createWorker, shutdownWorkers, QUEUE_NAMES } from "@lead-gen/queue";
import type { DeployJobData, DeployJobResult } from "@lead-gen/queue";
import { processDeployJob } from "./processor.js";

const worker = createWorker<DeployJobData, DeployJobResult>(
  {
    queueName: QUEUE_NAMES.DEPLOY,
    concurrency: 3,
  },
  processDeployJob,
);

console.log("[deploy] Worker started, waiting for jobs...");

const shutdown = () => shutdownWorkers([worker]);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
