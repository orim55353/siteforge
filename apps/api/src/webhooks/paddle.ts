import type { Request, Response } from "express";
import { createHmac } from "node:crypto";
import { prisma } from "@lead-gen/db";

/**
 * Paddle webhook handler for transaction.completed events.
 *
 * When a customer completes a checkout:
 * 1. Verify the webhook signature
 * 2. Extract transaction data and custom data (slug, businessId)
 * 3. Upsert Customer row
 * 4. Create Order + OrderItem rows
 * 5. If extra_pages item is present, enqueue the extra-pages job
 */
export async function handlePaddleWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  // ── Verify signature ──
  const signature = req.headers["paddle-signature"] as string | undefined;
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("[paddle] Missing PADDLE_WEBHOOK_SECRET");
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }

  if (!signature) {
    res.status(401).json({ error: "Missing Paddle-Signature header" });
    return;
  }

  const rawBody = JSON.stringify(req.body);
  if (!verifyPaddleSignature(signature, rawBody, webhookSecret)) {
    console.warn("[paddle] Invalid webhook signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const event = req.body;
  const eventType = event.event_type;

  console.log(`[paddle] Received event: ${eventType}`);

  if (eventType !== "transaction.completed") {
    // Acknowledge but ignore non-transaction events
    res.status(200).json({ received: true });
    return;
  }

  try {
    await handleTransactionCompleted(event.data);
    res.status(200).json({ received: true });
  } catch (err) {
    console.error("[paddle] Error processing transaction:", err);
    res.status(500).json({ error: "Internal processing error" });
  }
}

interface PaddleTransactionData {
  id: string; // txn_ ID
  customer_id: string; // ctm_ ID
  status: string;
  custom_data?: {
    slug?: string;
    businessId?: string;
    customerName?: string;
    phone?: string;
  };
  details?: {
    totals?: {
      total: string;
      currency_code: string;
    };
  };
  items: Array<{
    price: {
      id: string; // pri_ ID
      product_id: string;
      unit_price: {
        amount: string;
        currency_code: string;
      };
      billing_cycle: { interval: string; frequency: number } | null;
    };
    quantity: number;
  }>;
  customer?: {
    email: string;
    name?: string;
  };
}

// Map of known Paddle price IDs to product types
// These should match the price IDs configured in Paddle
const PRICE_TO_PRODUCT: Record<string, { productType: string; billingType: string }> = {
  // Populated from env or hardcoded for known products
  // Override via PADDLE_EXTRA_PAGES_PRICE_ID env var
};

function getExtraPagesPriceId(): string | null {
  return process.env.PADDLE_EXTRA_PAGES_PRICE_ID ?? null;
}

async function handleTransactionCompleted(
  data: PaddleTransactionData,
): Promise<void> {
  const customData = data.custom_data ?? {};
  const customerEmail = data.customer?.email;
  const customerName = customData.customerName ?? data.customer?.name ?? "Unknown";

  if (!customerEmail) {
    console.warn("[paddle] No customer email in transaction, skipping");
    return;
  }

  console.log(
    `[paddle] Processing transaction ${data.id} for ${customerEmail}`,
  );

  // ── Upsert Customer ──
  const customer = await prisma.customer.upsert({
    where: { email: customerEmail },
    update: {
      paddleCustomerId: data.customer_id,
      name: customerName,
      phone: customData.phone ?? undefined,
      businessId: customData.businessId ?? undefined,
    },
    create: {
      email: customerEmail,
      paddleCustomerId: data.customer_id,
      name: customerName,
      phone: customData.phone ?? undefined,
      businessId: customData.businessId ?? undefined,
    },
  });

  // ── Calculate total amount ──
  const totalAmount = data.details?.totals?.total
    ? parseInt(data.details.totals.total, 10)
    : data.items.reduce(
        (sum, item) => sum + parseInt(item.price.unit_price.amount, 10) * item.quantity,
        0,
      );

  const currency = data.details?.totals?.currency_code ?? "USD";

  // ── Create Order ──
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      paddleTransactionId: data.id,
      status: "pending",
      totalAmount,
      currency,
      metadata: {
        slug: customData.slug,
        businessId: customData.businessId,
        paddleCustomerId: data.customer_id,
      },
    },
  });

  console.log(`[paddle] Created order ${order.id}`);

  // ── Create OrderItems ──
  const extraPagesPriceId = getExtraPagesPriceId();
  let hasExtraPages = false;

  for (const item of data.items) {
    const priceId = item.price.id;
    const isRecurring = item.price.billing_cycle !== null;
    const amount = parseInt(item.price.unit_price.amount, 10) * item.quantity;

    // Determine product type from price ID
    const known = PRICE_TO_PRODUCT[priceId];
    const productType = known?.productType ?? inferProductType(priceId, extraPagesPriceId);
    const billingType = known?.billingType ?? (isRecurring ? "recurring" : "one_time");

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productType: productType as "website" | "extra_pages" | "custom_domain" | "online_booking",
        paddlePriceId: priceId,
        amount,
        billingType: billingType as "one_time" | "recurring",
      },
    });

    if (productType === "extra_pages") {
      hasExtraPages = true;
    }
  }

  // ── Fulfill extra_pages items immediately (pages are pre-generated on first page view) ──
  if (hasExtraPages) {
    const extraPagesItems = await prisma.orderItem.findMany({
      where: {
        orderId: order.id,
        productType: "extra_pages",
        fulfilledAt: null,
      },
    });

    for (const item of extraPagesItems) {
      await prisma.orderItem.update({
        where: { id: item.id },
        data: { fulfilledAt: new Date() },
      });
    }

    console.log(
      `[paddle] Marked ${extraPagesItems.length} extra_pages item(s) as fulfilled`,
    );
  }

  // Mark order as fulfilled
  await prisma.order.update({
    where: { id: order.id },
    data: { status: "fulfilled" },
  });
}

function inferProductType(priceId: string, extraPagesPriceId: string | null): string {
  if (extraPagesPriceId && priceId === extraPagesPriceId) {
    return "extra_pages";
  }
  // Default to website for unknown price IDs
  return "website";
}

/**
 * Verify Paddle webhook signature.
 *
 * Paddle sends signatures in the format: ts=TIMESTAMP;h1=HASH
 * The hash is HMAC-SHA256 of "TIMESTAMP:RAW_BODY" with the webhook secret.
 */
function verifyPaddleSignature(
  signatureHeader: string,
  rawBody: string,
  secret: string,
): boolean {
  try {
    const parts = signatureHeader.split(";");
    const tsPart = parts.find((p) => p.startsWith("ts="));
    const h1Part = parts.find((p) => p.startsWith("h1="));

    if (!tsPart || !h1Part) return false;

    const timestamp = tsPart.replace("ts=", "");
    const expectedHash = h1Part.replace("h1=", "");

    const payload = `${timestamp}:${rawBody}`;
    const computedHash = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    return computedHash === expectedHash;
  } catch {
    return false;
  }
}
