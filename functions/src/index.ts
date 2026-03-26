/**
 * GCP Cloud Functions entry points.
 *
 * Each export is a named Cloud Function that can be deployed independently:
 *   gcloud functions deploy trackPageView --entry-point=trackPageView ...
 *
 * For local development, these same handlers are mounted in the Express app (apps/api).
 */

export { trackPageView } from "./track-page-view.js";
export { handleCheckoutEvent } from "./checkout-event.js";
export { handleInboundEmail } from "./inbound-email.js";
export { handleEmailEvents } from "./email-events.js";
export { handlePaymentWebhook } from "./paddle-webhook.js";
export { runPipeline } from "./run-pipeline.js";
export { sendDueOutreach } from "./send-due-outreach.js";
export { generateExtraPages } from "./generate-extra-pages.js";
export { healthCheck } from "./health.js";
