import { createWorker, shutdownWorkers, QUEUE_NAMES } from "@lead-gen/queue";
import type { EnrichmentJobData, EnrichmentJobResult } from "@lead-gen/queue";
import { processEnrichmentJob } from "./processor.js";

const worker = createWorker<EnrichmentJobData, EnrichmentJobResult>(
  {
    queueName: QUEUE_NAMES.ENRICHMENT,
    concurrency: 5,
  },
  processEnrichmentJob,
);

console.log("[enrichment] Worker started, waiting for jobs...");

const shutdown = () => shutdownWorkers([worker]);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
