import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { allQueues } from "./queues.js";

/**
 * Creates a Bull Board Express adapter for mounting in the admin app.
 *
 * Usage in Express/Next.js API route:
 * ```ts
 * import { createBoardAdapter } from "@lead-gen/queue/board";
 *
 * const boardAdapter = createBoardAdapter("/admin/queues");
 * app.use("/admin/queues", boardAdapter.getRouter());
 * ```
 */
export function createBoardAdapter(basePath = "/admin/queues"): ExpressAdapter {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(basePath);

  createBullBoard({
    queues: allQueues.map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });

  return serverAdapter;
}
