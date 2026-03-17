import { Worker, Job } from "bullmq";
import type { ConnectionOptions, WorkerOptions } from "bullmq";
import { redisConnection } from "./connection.js";

export interface WorkerConfig<TData, TResult> {
  /** Queue name this worker processes */
  queueName: string;
  /** Concurrency — how many jobs to process in parallel */
  concurrency?: number;
  /** Rate limiter config */
  limiter?: { max: number; duration: number };
  /** Additional BullMQ worker options */
  workerOptions?: Partial<WorkerOptions>;
}

/**
 * Creates a typed BullMQ worker with standard error handling and graceful shutdown.
 *
 * Usage:
 * ```ts
 * const worker = createWorker<EnrichmentJobData, EnrichmentJobResult>({
 *   queueName: QUEUE_NAMES.ENRICHMENT,
 *   concurrency: 5,
 * }, async (job) => {
 *   // process job
 *   return { businessId: job.data.businessId, websiteScore: 85 };
 * });
 * ```
 */
export function createWorker<TData, TResult>(
  config: WorkerConfig<TData, TResult>,
  processor: (job: Job<TData, TResult>) => Promise<TResult>,
): Worker<TData, TResult> {
  const worker = new Worker<TData, TResult>(
    config.queueName,
    processor,
    {
      connection: redisConnection,
      concurrency: config.concurrency ?? 1,
      limiter: config.limiter,
      ...config.workerOptions,
    },
  );

  worker.on("completed", (job) => {
    console.log(`[${config.queueName}] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[${config.queueName}] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      err.message,
    );
  });

  worker.on("error", (err) => {
    console.error(`[${config.queueName}] Worker error:`, err.message);
  });

  return worker;
}

/**
 * Gracefully shut down a list of workers.
 * Call this on SIGTERM/SIGINT in each worker process.
 */
export async function shutdownWorkers(workers: Worker[]): Promise<void> {
  console.log("Shutting down workers...");
  await Promise.allSettled(workers.map((w) => w.close()));
  console.log("All workers shut down.");
}
