export const dynamic = "force-dynamic";

export default function QueuesPage() {
  return (
    <div>
      <h2 className="mb-6 text-2xl font-semibold">Job Queues</h2>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-6 text-sm text-blue-800">
        <p className="mb-2 font-medium">Serverless Architecture</p>
        <p>
          The platform has been migrated to GCP Cloud Functions. Job queues
          (BullMQ/Redis) have been replaced with direct function calls and
          Cloud Scheduler.
        </p>
        <ul className="mt-3 list-disc pl-5 space-y-1">
          <li>Pipeline steps run as direct async function calls</li>
          <li>Email sending is triggered hourly by Cloud Scheduler</li>
          <li>Extra pages are generated on first page view</li>
          <li>
            Monitor function invocations in the{" "}
            <a
              href="https://console.cloud.google.com/functions"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              GCP Console
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
