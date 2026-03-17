import express from "express";
import cors from "cors";
import { handleInboundWebhook } from "./webhooks/inbound.js";
import { handleEmailEventsWebhook } from "./webhooks/email-events.js";
import { handlePageView } from "./webhooks/page-view.js";
import { handleCheckoutEvent } from "./webhooks/checkout-event.js";
import { handlePaddleWebhook } from "./webhooks/paddle.js";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

app.use(express.json());

// CORS for checkout tracking (agency site → API)
app.use("/ce", cors({ origin: true }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Page view tracking (from Cloudflare Worker)
app.post("/t", handlePageView);

// Checkout event tracking (from agency checkout page)
app.post("/ce", handleCheckoutEvent);

// Resend inbound email webhook (reply ingestion)
app.post("/webhooks/inbound", handleInboundWebhook);

// Resend email event webhooks (delivered, opened, clicked, bounced, complained)
app.post("/webhooks/email-events", handleEmailEventsWebhook);

// Paddle payment webhooks (transaction.completed → order fulfillment)
app.post("/webhooks/paddle", handlePaddleWebhook);

app.listen(PORT, () => {
  console.log(`[api] Listening on port ${PORT}`);
});
