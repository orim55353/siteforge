import { Queue } from "bullmq";
import { redisConnection } from "./connection.js";
import type {
  DiscoveryJobData,
  EnrichmentJobData,
  ScoringJobData,
  PageGenJobData,
  DeployJobData,
  SchedulerJobData,
  EmailJobData,
  ExtraPagesJobData,
  ReplyIngestionJobData,
  DiscoveryJobResult,
  EnrichmentJobResult,
  ScoringJobResult,
  PageGenJobResult,
  DeployJobResult,
  SchedulerJobResult,
  EmailJobResult,
  ExtraPagesJobResult,
  ReplyIngestionJobResult,
} from "./jobs.js";

// ─── Queue Names ─────────────────────────────────────────────

export const QUEUE_NAMES = {
  DISCOVERY: "discovery",
  ENRICHMENT: "enrichment",
  SCORING: "scoring",
  PAGE_GEN: "page-gen",
  DEPLOY: "deploy",
  SCHEDULER: "scheduler",
  EMAIL: "email",
  EXTRA_PAGES: "extra-pages",
  REPLY_INGESTION: "reply-ingestion",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Default Queue Options ───────────────────────────────────

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 3600 }, // keep 7 days
  removeOnFail: { age: 30 * 24 * 3600 },    // keep 30 days
};

// ─── Typed Queue Instances ───────────────────────────────────

export const discoveryQueue = new Queue<DiscoveryJobData, DiscoveryJobResult>(
  QUEUE_NAMES.DISCOVERY,
  { connection: redisConnection, defaultJobOptions },
);

export const enrichmentQueue = new Queue<EnrichmentJobData, EnrichmentJobResult>(
  QUEUE_NAMES.ENRICHMENT,
  { connection: redisConnection, defaultJobOptions },
);

export const scoringQueue = new Queue<ScoringJobData, ScoringJobResult>(
  QUEUE_NAMES.SCORING,
  { connection: redisConnection, defaultJobOptions },
);

export const pageGenQueue = new Queue<PageGenJobData, PageGenJobResult>(
  QUEUE_NAMES.PAGE_GEN,
  { connection: redisConnection, defaultJobOptions },
);

export const deployQueue = new Queue<DeployJobData, DeployJobResult>(
  QUEUE_NAMES.DEPLOY,
  { connection: redisConnection, defaultJobOptions },
);

export const schedulerQueue = new Queue<SchedulerJobData, SchedulerJobResult>(
  QUEUE_NAMES.SCHEDULER,
  { connection: redisConnection, defaultJobOptions },
);

export const emailQueue = new Queue<EmailJobData, EmailJobResult>(
  QUEUE_NAMES.EMAIL,
  {
    connection: redisConnection,
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 2, // fewer retries for email to avoid duplicates
    },
  },
);

export const extraPagesQueue = new Queue<ExtraPagesJobData, ExtraPagesJobResult>(
  QUEUE_NAMES.EXTRA_PAGES,
  { connection: redisConnection, defaultJobOptions },
);

export const replyIngestionQueue = new Queue<ReplyIngestionJobData, ReplyIngestionJobResult>(
  QUEUE_NAMES.REPLY_INGESTION,
  { connection: redisConnection, defaultJobOptions },
);

/** All queues for Bull Board registration */
export const allQueues = [
  discoveryQueue,
  enrichmentQueue,
  scoringQueue,
  pageGenQueue,
  deployQueue,
  schedulerQueue,
  emailQueue,
  extraPagesQueue,
  replyIngestionQueue,
] as const;
