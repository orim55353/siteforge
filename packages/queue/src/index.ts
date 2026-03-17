// Connection
export { redisConnection } from "./connection.js";

// Queue names & instances
export {
  QUEUE_NAMES,
  type QueueName,
  discoveryQueue,
  enrichmentQueue,
  scoringQueue,
  pageGenQueue,
  deployQueue,
  schedulerQueue,
  emailQueue,
  replyIngestionQueue,
  allQueues,
} from "./queues.js";

// Job payload types
export type {
  DiscoveryJobData,
  EnrichmentJobData,
  ScoringJobData,
  PageGenJobData,
  DeployJobData,
  SchedulerJobData,
  EmailJobData,
  ReplyIngestionJobData,
  DiscoveryJobResult,
  EnrichmentJobResult,
  ScoringJobResult,
  PageGenJobResult,
  DeployJobResult,
  SchedulerJobResult,
  EmailJobResult,
  ReplyIngestionJobResult,
} from "./jobs.js";

// Worker utilities
export { createWorker, shutdownWorkers } from "./worker-base.js";
export type { WorkerConfig } from "./worker-base.js";

// Bull Board (admin UI)
export { createBoardAdapter } from "./board.js";
