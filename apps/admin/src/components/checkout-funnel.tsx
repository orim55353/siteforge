"use client";

import { useState } from "react";

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

interface SessionEvent {
  sessionId: string;
  event: string;
  metadata: unknown;
  occurredAt: string | Date;
}

interface RecentSession {
  sessionId: string;
  slug: string | null;
  business: string | null;
  deviceType: string | null;
  startedAt: string | Date;
  events: SessionEvent[];
  lastEvent: string;
  converted: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  fullName: "Full Name",
  businessName: "Business Name",
  email: "Email",
  phone: "Phone",
  cardNumber: "Card Number",
  cardExpiry: "Card Expiry",
  cardCvc: "CVC",
};

const UPSELL_LABELS: Record<string, string> = {
  domain: "Custom Domain ($10/mo)",
  pages: "Additional Pages ($29)",
  booking: "Online Booking ($19/mo)",
};

const EVENT_LABELS: Record<string, string> = {
  checkout_viewed: "Viewed",
  upsell_toggled: "Upsell Toggle",
  form_started: "Form Started",
  field_completed: "Field Done",
  payment_attempted: "Pay Attempted",
  payment_success: "Paid",
  page_abandoned: "Abandoned",
};

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DeviceBar({ devices }: { devices: DeviceBreakdown }) {
  const total = devices.mobile + devices.tablet + devices.desktop;
  if (total === 0) return <p className="text-sm text-gray-400">No data</p>;

  const pcts = {
    mobile: ((devices.mobile / total) * 100).toFixed(0),
    tablet: ((devices.tablet / total) * 100).toFixed(0),
    desktop: ((devices.desktop / total) * 100).toFixed(0),
  };

  return (
    <div className="space-y-2">
      {(["mobile", "tablet", "desktop"] as const).map((type) => (
        <div key={type} className="flex items-center gap-3">
          <span className="w-16 text-sm capitalize text-gray-600">{type}</span>
          <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                type === "mobile"
                  ? "bg-blue-500"
                  : type === "tablet"
                    ? "bg-purple-500"
                    : "bg-green-500"
              }`}
              style={{ width: `${pcts[type]}%` }}
            />
          </div>
          <span className="w-16 text-right text-sm text-gray-600">
            {pcts[type]}% ({devices[type]})
          </span>
        </div>
      ))}
    </div>
  );
}

export function CheckoutFunnel({
  funnel,
  dropoffFields,
  upsellStats,
  devices,
  recentSessions,
}: {
  funnel: FunnelStep[];
  dropoffFields: DropoffField[];
  upsellStats: UpsellStat[];
  devices: DeviceBreakdown;
  recentSessions: RecentSession[];
}) {
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const maxSessions = funnel[0]?.sessions ?? 1;

  return (
    <div className="space-y-8">
      {/* Funnel Visualization */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold">Conversion Funnel</h3>
        {funnel.length === 0 ? (
          <p className="text-gray-500">No checkout events recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {funnel.map((step, i) => {
              const widthPct = maxSessions > 0 ? (step.sessions / maxSessions) * 100 : 0;

              return (
                <div key={step.event}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">{step.label}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold">{step.sessions}</span>
                      {i > 0 && step.dropoffPct > 0 && (
                        <span className="text-xs text-red-500">
                          -{step.dropoff} ({step.dropoffPct.toFixed(0)}%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-8 w-full rounded bg-gray-100">
                    <div
                      className={`h-full rounded transition-all ${
                        step.event === "payment_success"
                          ? "bg-green-500"
                          : "bg-indigo-500"
                      }`}
                      style={{ width: `${Math.max(widthPct, 1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Field Dropoff */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h3 className="mb-4 text-lg font-semibold">Where People Drop Off</h3>
          <p className="mb-3 text-xs text-gray-500">
            Number of abandoned sessions that never completed each field
          </p>
          {dropoffFields.length === 0 ? (
            <p className="text-gray-500">No abandonment data yet.</p>
          ) : (
            <div className="space-y-2">
              {dropoffFields.map((f) => {
                const maxCount = Math.max(...dropoffFields.map((d) => d.count), 1);
                const widthPct = (f.count / maxCount) * 100;

                return (
                  <div key={f.field} className="flex items-center gap-3">
                    <span className="w-28 text-sm text-gray-600">
                      {FIELD_LABELS[f.field] ?? f.field}
                    </span>
                    <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-red-400"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-sm font-medium">{f.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Upsell Performance */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h3 className="mb-4 text-lg font-semibold">Upsell Performance</h3>
          {upsellStats.length === 0 ? (
            <p className="text-gray-500">No upsell data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Upsell</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Toggled On</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Toggled Off</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Purchase Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {upsellStats.map((u) => (
                    <tr key={u.upsell}>
                      <td className="px-3 py-2 text-gray-700">
                        {UPSELL_LABELS[u.upsell] ?? u.upsell}
                      </td>
                      <td className="px-3 py-2 text-right text-green-600 font-medium">
                        {u.toggledOn}
                      </td>
                      <td className="px-3 py-2 text-right text-red-500">{u.toggledOff}</td>
                      <td className="px-3 py-2 text-right font-bold">{u.netRate.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Device Breakdown */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h3 className="mb-4 text-lg font-semibold">Device Breakdown</h3>
          <DeviceBar devices={devices} />
        </div>
      </div>

      {/* Recent Sessions */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold">Recent Sessions</h3>
        {recentSessions.length === 0 ? (
          <p className="text-gray-500">No sessions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Business</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Device</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Last Step</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentSessions.map((session) => (
                  <>
                    <tr
                      key={session.sessionId}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() =>
                        setExpandedSession(
                          expandedSession === session.sessionId ? null : session.sessionId,
                        )
                      }
                    >
                      <td className="px-3 py-2 text-gray-700">
                        {session.business ?? session.slug ?? "Unknown"}
                      </td>
                      <td className="px-3 py-2 capitalize text-gray-600">
                        {session.deviceType ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {EVENT_LABELS[session.lastEvent] ?? session.lastEvent}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            session.converted
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {session.converted ? "Converted" : "Dropped"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {formatDate(session.startedAt)}
                      </td>
                    </tr>
                    {expandedSession === session.sessionId && (
                      <tr key={`${session.sessionId}-detail`}>
                        <td colSpan={5} className="bg-gray-50 px-6 py-3">
                          <div className="space-y-1">
                            {session.events.map((evt, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-3 text-xs"
                              >
                                <span className="text-gray-400 w-32">
                                  {formatDate(evt.occurredAt)}
                                </span>
                                <span
                                  className={`font-medium ${
                                    evt.event === "payment_success"
                                      ? "text-green-600"
                                      : evt.event === "page_abandoned"
                                        ? "text-red-500"
                                        : "text-gray-700"
                                  }`}
                                >
                                  {EVENT_LABELS[evt.event] ?? evt.event}
                                </span>
                                {evt.metadata != null && (
                                  <span className="text-gray-400">
                                    {JSON.stringify(evt.metadata)}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
