import type { ConnectionOptions } from "bullmq";

export const redisConnection: ConnectionOptions = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
};

// Parse REDIS_URL if provided (takes precedence)
if (process.env.REDIS_URL) {
  const url = new URL(process.env.REDIS_URL);
  redisConnection.host = url.hostname;
  redisConnection.port = Number(url.port) || 6379;
  if (url.password) redisConnection.password = url.password;
  if (url.username) redisConnection.username = url.username;
  // Enable TLS for rediss:// URLs (e.g. Upstash)
  if (url.protocol === "rediss:") {
    redisConnection.tls = {};
  }
}
