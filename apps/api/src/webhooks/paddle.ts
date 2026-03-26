import type { Request, Response } from "express";

/**
 * Payment provider webhook handler — PLACEHOLDER
 *
 * TODO: Replace with the chosen payment provider's webhook handler.
 *
 * Expected behavior when implemented:
 * 1. Verify the webhook signature (provider-specific header/secret)
 * 2. Handle "transaction completed" / "payment succeeded" event
 * 3. Upsert Customer row (email, name, phone, businessId)
 * 4. Create Order + OrderItem rows
 * 5. Fulfill extra_pages items if purchased
 * 6. Mark order as "fulfilled"
 *
 * Provider candidates: Stripe, Lemon Squeezy, Paddle, Whop, etc.
 */
export async function handlePaymentWebhook(
  _req: Request,
  res: Response,
): Promise<void> {
  // TODO: implement payment provider webhook
  res.status(501).json({ error: "Payment webhook not yet implemented" });
}
