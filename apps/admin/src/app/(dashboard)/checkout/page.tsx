import { prisma } from "@/lib/prisma";
import { CheckoutFunnel } from "@/components/checkout-funnel";

export const dynamic = "force-dynamic";

const FUNNEL_STEPS = [
  "checkout_viewed",
  "form_started",
  "field_completed",
  "payment_attempted",
  "payment_success",
] as const;

const STEP_LABELS: Record<string, string> = {
  checkout_viewed: "Page Viewed",
  form_started: "Form Started",
  field_completed: "Field Completed",
  payment_attempted: "Payment Attempted",
  payment_success: "Payment Success",
};

interface FunnelStep {
  event: string;
  label: string;
  sessions: number;
  dropoff: number;
  dropoffPct: number;
}

interface DropoffField {
  field: string;
  count: number;
}

interface UpsellStat {
  upsell: string;
  toggledOn: number;
  toggledOff: number;
  netRate: number;
}

interface DeviceBreakdown {
  mobile: number;
  tablet: number;
  desktop: number;
}

async function getFunnelData(): Promise<FunnelStep[]> {
  const counts = await Promise.all(
    FUNNEL_STEPS.map(async (event) => {
      const result = await prisma.checkoutEvent.findMany({
        where: { event },
        distinct: ["sessionId"],
        select: { sessionId: true },
      });
      return { event, sessions: result.length };
    }),
  );

  return counts.map((step, i) => {
    const prev = i > 0 ? counts[i - 1].sessions : step.sessions;
    const dropoff = prev - step.sessions;
    const dropoffPct = prev > 0 ? (dropoff / prev) * 100 : 0;

    return {
      event: step.event,
      label: STEP_LABELS[step.event] ?? step.event,
      sessions: step.sessions,
      dropoff,
      dropoffPct,
    };
  });
}

async function getOverallStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [totalSessions, sessionsToday, sessionsWeek, conversions, conversionsToday] =
    await Promise.all([
      prisma.checkoutEvent
        .findMany({
          where: { event: "checkout_viewed" },
          distinct: ["sessionId"],
          select: { sessionId: true },
        })
        .then((r) => r.length),
      prisma.checkoutEvent
        .findMany({
          where: { event: "checkout_viewed", occurredAt: { gte: todayStart } },
          distinct: ["sessionId"],
          select: { sessionId: true },
        })
        .then((r) => r.length),
      prisma.checkoutEvent
        .findMany({
          where: { event: "checkout_viewed", occurredAt: { gte: weekAgo } },
          distinct: ["sessionId"],
          select: { sessionId: true },
        })
        .then((r) => r.length),
      prisma.checkoutEvent
        .findMany({
          where: { event: "payment_success" },
          distinct: ["sessionId"],
          select: { sessionId: true },
        })
        .then((r) => r.length),
      prisma.checkoutEvent
        .findMany({
          where: { event: "payment_success", occurredAt: { gte: todayStart } },
          distinct: ["sessionId"],
          select: { sessionId: true },
        })
        .then((r) => r.length),
    ]);

  const conversionRate = totalSessions > 0 ? (conversions / totalSessions) * 100 : 0;

  return { totalSessions, sessionsToday, sessionsWeek, conversions, conversionsToday, conversionRate };
}

async function getDropoffFields(): Promise<DropoffField[]> {
  // Find sessions that abandoned — look at what fields they completed
  const abandonedEvents = await prisma.checkoutEvent.findMany({
    where: { event: "page_abandoned" },
    select: { metadata: true },
    orderBy: { occurredAt: "desc" },
    take: 500,
  });

  const fieldCounts: Record<string, number> = {
    fullName: 0,
    businessName: 0,
    email: 0,
    phone: 0,
    cardNumber: 0,
    cardExpiry: 0,
    cardCvc: 0,
  };
  const totalAbandoned = abandonedEvents.length;

  for (const evt of abandonedEvents) {
    const meta = evt.metadata as { fieldsCompleted?: string[] } | null;
    const fields = meta?.fieldsCompleted ?? [];
    for (const field of fields) {
      if (field in fieldCounts) {
        fieldCounts[field]++;
      }
    }
  }

  // Show which fields were NOT completed (where people dropped)
  const allFields = ["fullName", "businessName", "email", "phone", "cardNumber", "cardExpiry", "cardCvc"];
  return allFields.map((field) => ({
    field,
    count: totalAbandoned - (fieldCounts[field] ?? 0),
  }));
}

async function getUpsellStats(): Promise<UpsellStat[]> {
  const toggleEvents = await prisma.checkoutEvent.findMany({
    where: { event: "upsell_toggled" },
    select: { metadata: true },
  });

  const stats: Record<string, { on: number; off: number }> = {};

  for (const evt of toggleEvents) {
    const meta = evt.metadata as { upsell?: string; enabled?: boolean } | null;
    if (!meta?.upsell) continue;

    if (!stats[meta.upsell]) {
      stats[meta.upsell] = { on: 0, off: 0 };
    }
    if (meta.enabled) {
      stats[meta.upsell].on++;
    } else {
      stats[meta.upsell].off++;
    }
  }

  // Also count how many successful payments included each upsell
  const successEvents = await prisma.checkoutEvent.findMany({
    where: { event: "payment_success" },
    select: { metadata: true },
  });

  const purchasedWith: Record<string, number> = {};
  for (const evt of successEvents) {
    const meta = evt.metadata as { upsells?: Record<string, boolean> } | null;
    if (!meta?.upsells) continue;
    for (const [key, enabled] of Object.entries(meta.upsells)) {
      if (enabled) {
        purchasedWith[key] = (purchasedWith[key] ?? 0) + 1;
      }
    }
  }

  return Object.entries(stats).map(([upsell, { on, off }]) => ({
    upsell,
    toggledOn: on,
    toggledOff: off,
    netRate: successEvents.length > 0
      ? ((purchasedWith[upsell] ?? 0) / successEvents.length) * 100
      : 0,
  }));
}

async function getDeviceBreakdown(): Promise<DeviceBreakdown> {
  const rows = await prisma.checkoutEvent.groupBy({
    by: ["deviceType"],
    where: { event: "checkout_viewed" },
    _count: { id: true },
  });

  const devices: DeviceBreakdown = { mobile: 0, tablet: 0, desktop: 0 };
  for (const row of rows) {
    const dt = row.deviceType as keyof DeviceBreakdown;
    if (dt in devices) {
      devices[dt] = row._count.id;
    }
  }
  return devices;
}

async function getRecentSessions() {
  // Get last 20 unique sessions with their events
  const recentViews = await prisma.checkoutEvent.findMany({
    where: { event: "checkout_viewed" },
    orderBy: { occurredAt: "desc" },
    take: 20,
    select: { sessionId: true, slug: true, business: true, deviceType: true, occurredAt: true },
  });

  const sessionIds = recentViews.map((v) => v.sessionId);

  const allEvents = await prisma.checkoutEvent.findMany({
    where: { sessionId: { in: sessionIds } },
    orderBy: { occurredAt: "asc" },
    select: { sessionId: true, event: true, metadata: true, occurredAt: true },
  });

  const eventsBySession = new Map<string, typeof allEvents>();
  for (const evt of allEvents) {
    const existing = eventsBySession.get(evt.sessionId) ?? [];
    existing.push(evt);
    eventsBySession.set(evt.sessionId, existing);
  }

  return recentViews.map((view) => ({
    sessionId: view.sessionId,
    slug: view.slug,
    business: view.business,
    deviceType: view.deviceType,
    startedAt: view.occurredAt,
    events: eventsBySession.get(view.sessionId) ?? [],
    lastEvent: (eventsBySession.get(view.sessionId) ?? []).slice(-1)[0]?.event ?? "checkout_viewed",
    converted: (eventsBySession.get(view.sessionId) ?? []).some((e) => e.event === "payment_success"),
  }));
}

export default async function CheckoutPage() {
  const [overall, funnel, dropoffFields, upsellStats, devices, recentSessions] = await Promise.all([
    getOverallStats(),
    getFunnelData(),
    getDropoffFields(),
    getUpsellStats(),
    getDeviceBreakdown(),
    getRecentSessions(),
  ]);

  return (
    <div>
      <h2 className="mb-6 text-2xl font-semibold">Checkout Analytics</h2>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Total Sessions</p>
          <p className="text-2xl font-bold">{overall.totalSessions.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Today</p>
          <p className="text-2xl font-bold">{overall.sessionsToday.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">This Week</p>
          <p className="text-2xl font-bold">{overall.sessionsWeek.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Conversions</p>
          <p className="text-2xl font-bold">{overall.conversions.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Today&apos;s Conversions</p>
          <p className="text-2xl font-bold">{overall.conversionsToday.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Conversion Rate</p>
          <p className="text-2xl font-bold">{overall.conversionRate.toFixed(1)}%</p>
        </div>
      </div>

      <CheckoutFunnel
        funnel={funnel}
        dropoffFields={dropoffFields}
        upsellStats={upsellStats}
        devices={devices}
        recentSessions={recentSessions}
      />
    </div>
  );
}
