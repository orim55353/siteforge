import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@lead-gen/db"],
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis"],
};

export default nextConfig;
