import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BusinessStatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";

async function getBusiness(id: string) {
  return prisma.business.findUnique({
    where: { id },
    include: {
      market: true,
      previewPages: { orderBy: { createdAt: "desc" }, take: 1 },
      intentPages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

export default async function BusinessDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const business = await getBusiness(id);

  if (!business) return notFound();

  const previewPage = business.previewPages[0] ?? null;
  const intentPage = business.intentPages[0] ?? null;
  const pageUrl = intentPage?.deployedUrl ?? previewPage?.htmlUrl ?? null;

  const reviews = (business.reviews as Array<{
    author: string;
    rating: number;
    text: string;
    date?: string;
    isLocalGuide?: boolean;
  }>) ?? [];

  const scoreBreakdown = business.scoreBreakdown as Record<string, number> | null;
  const socialProfiles = business.socialProfiles as Record<string, string> | null;

  return (
    <div>
      {/* Back link + header */}
      <Link
        href="/"
        className="mb-4 inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        &larr; Back to Pipeline
      </Link>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{business.name}</h2>
          <p className="mt-1 text-sm text-gray-500">
            {business.market.industry} &middot;{" "}
            {[business.city, business.state].filter(Boolean).join(", ")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <BusinessStatusBadge status={business.status} />
          {pageUrl && (
            <a
              href={pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              View Generated Page &rarr;
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Contact & Location */}
        <Section title="Contact & Location">
          <InfoRow label="Phone" value={business.phone} isPhone />
          <InfoRow label="Email" value={business.email} isEmail />
          <InfoRow label="Website" value={business.website} isLink />
          <InfoRow label="Address" value={business.address} />
          <InfoRow
            label="City / State / Zip"
            value={[business.city, business.state, business.zipCode].filter(Boolean).join(", ")}
          />
          {business.googleMapsUrl && (
            <InfoRow label="Google Maps" value={business.googleMapsUrl} isLink linkLabel="Open in Maps" />
          )}
        </Section>

        {/* Rating & Score */}
        <Section title="Rating & Score">
          <div className="flex items-center gap-4 mb-3">
            {business.googleRating != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-bold text-yellow-600">
                  {business.googleRating.toFixed(1)}
                </span>
                <Stars rating={business.googleRating} />
              </div>
            )}
            {business.reviewCount != null && (
              <span className="text-sm text-gray-500">
                {business.reviewCount.toLocaleString()} reviews
              </span>
            )}
          </div>
          {business.score != null && (
            <div className="mb-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Lead Score</span>
                <span className="font-semibold">{business.score}/100</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-indigo-500"
                  style={{ width: `${business.score}%` }}
                />
              </div>
            </div>
          )}
          {scoreBreakdown && (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                Score Breakdown
              </p>
              {Object.entries(scoreBreakdown).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 capitalize">
                    {key.replace(/_/g, " ")}
                  </span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Categories & Enrichment */}
        <Section title="Business Details">
          {business.categories.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-gray-400">
                Categories
              </p>
              <div className="flex flex-wrap gap-1.5">
                {business.categories.map((cat) => (
                  <span
                    key={cat}
                    className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}
          <InfoRow label="Has Website" value={formatBool(business.hasWebsite)} />
          <InfoRow label="Website Score" value={business.websiteScore != null ? `${business.websiteScore}/100` : null} />
          <InfoRow label="SSL" value={formatBool(business.hasSsl)} />
          <InfoRow label="Mobile Friendly" value={formatBool(business.isMobileFriendly)} />
          <InfoRow label="Online Booking" value={formatBool(business.hasOnlineBooking)} />
          {business.techStack.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-400">
                Tech Stack
              </p>
              <div className="flex flex-wrap gap-1.5">
                {business.techStack.map((tech) => (
                  <span
                    key={tech}
                    className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-600"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          )}
          {socialProfiles && Object.keys(socialProfiles).length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-400">
                Social Profiles
              </p>
              <div className="space-y-1">
                {Object.entries(socialProfiles).map(([platform, url]) => (
                  <a
                    key={platform}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm capitalize text-indigo-600 hover:text-indigo-800"
                  >
                    {platform}
                  </a>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* Generated Pages */}
        <Section title="Generated Pages">
          {!previewPage && !intentPage && (
            <p className="text-sm text-gray-400">No pages generated yet</p>
          )}
          {previewPage && (
            <div className="mb-3">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1">
                Preview Page
              </p>
              <div className="rounded-md border border-gray-200 p-3 text-sm">
                <InfoRow label="Slug" value={previewPage.slug} />
                {previewPage.htmlUrl && (
                  <InfoRow label="HTML URL" value={previewPage.htmlUrl} isLink linkLabel="Open" />
                )}
                {previewPage.previewUrl && (
                  <InfoRow label="Preview URL" value={previewPage.previewUrl} isLink linkLabel="Open" />
                )}
                <InfoRow
                  label="Created"
                  value={new Date(previewPage.createdAt).toLocaleString()}
                />
              </div>
            </div>
          )}
          {intentPage && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1">
                Deployed Page
              </p>
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
                <InfoRow label="Slug" value={intentPage.slug} />
                <InfoRow label="Deployed URL" value={intentPage.deployedUrl} isLink linkLabel="Open Live Page" />
                <InfoRow
                  label="Deployed At"
                  value={new Date(intentPage.deployedAt).toLocaleString()}
                />
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* Reviews */}
      {reviews.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-lg font-medium">Google Reviews</h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {reviews.map((review, i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    {review.author}
                    {review.isLocalGuide && (
                      <span className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-600">
                        Local Guide
                      </span>
                    )}
                  </span>
                  <Stars rating={review.rating} size="sm" />
                </div>
                <p className="text-sm text-gray-600 line-clamp-4">
                  {review.text}
                </p>
                {review.date && (
                  <p className="mt-2 text-xs text-gray-400">{review.date}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-xs text-gray-400">
          ID: {business.id} &middot; Created:{" "}
          {new Date(business.createdAt).toLocaleString()} &middot; Updated:{" "}
          {new Date(business.updatedAt).toLocaleString()}
          {business.timezone && <> &middot; Timezone: {business.timezone}</>}
          {business.approvedAt && (
            <>
              {" "}
              &middot; Approved: {new Date(business.approvedAt).toLocaleString()}
              {business.approvedBy && ` by ${business.approvedBy}`}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// ─── Helper Components ─────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
        {title}
      </h3>
      {children}
    </div>
  );
}

function InfoRow({
  label,
  value,
  isLink,
  isPhone,
  isEmail,
  linkLabel,
}: {
  label: string;
  value: string | null | undefined;
  isLink?: boolean;
  isPhone?: boolean;
  isEmail?: boolean;
  linkLabel?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      {isLink ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 hover:text-indigo-800 text-right max-w-[60%] truncate"
        >
          {linkLabel ?? value}
        </a>
      ) : isPhone ? (
        <a href={`tel:${value}`} className="text-indigo-600 hover:text-indigo-800">
          {value}
        </a>
      ) : isEmail ? (
        <a href={`mailto:${value}`} className="text-indigo-600 hover:text-indigo-800">
          {value}
        </a>
      ) : (
        <span className="text-gray-900 text-right max-w-[60%]">{value}</span>
      )}
    </div>
  );
}

function Stars({ rating, size = "md" }: { rating: number; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={`${sizeClass} ${
            star <= Math.round(rating) ? "text-yellow-400" : "text-gray-300"
          }`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </span>
  );
}

function formatBool(value: boolean | null | undefined): string | null {
  if (value == null) return null;
  return value ? "Yes" : "No";
}
