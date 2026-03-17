import { createWorker, shutdownWorkers, QUEUE_NAMES } from "@lead-gen/queue";
import type { DiscoveryJobData, DiscoveryJobResult } from "@lead-gen/queue";
import { processDiscoveryJob } from "./processor.js";

const worker = createWorker<DiscoveryJobData, DiscoveryJobResult>(
  {
    queueName: QUEUE_NAMES.DISCOVERY,
    concurrency: 2, // limit parallel API calls to avoid rate limits
  },
  processDiscoveryJob,
);

console.log("[discovery] Worker started, waiting for jobs...");

// Graceful shutdown
const shutdown = () => shutdownWorkers([worker]);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
