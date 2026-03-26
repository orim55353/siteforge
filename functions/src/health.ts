import type { Request, Response } from "express";

export async function healthCheck(_req: Request, res: Response): Promise<void> {
  res.json({ status: "ok", runtime: "gcp-cloud-functions" });
}
