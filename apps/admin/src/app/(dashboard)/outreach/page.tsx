import { prisma } from "@/lib/prisma";
import { OutreachTable } from "@/components/outreach-table";

export const dynamic = "force-dynamic";

async function getOutreachMessages(page: number, pageSize: number) {
  const [messages, total] = await Promise.all([
    prisma.outreachMessage.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        toEmail: true,
        subject: true,
        status: true,
        scheduledFor: true,
        sentAt: true,
        createdAt: true,
        business: { select: { id: true, name: true } },
        campaign: { select: { name: true } },
        emailEvents: {
          select: { type: true, occurredAt: true },
          orderBy: { occurredAt: "desc" },
        },
        replies: {
          select: { id: true, createdAt: true },
          take: 1,
        },
      },
    }),
    prisma.outreachMessage.count(),
  ]);

  return { messages, total };
}

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const pageSize = 25;

  const { messages, total } = await getOutreachMessages(page, pageSize);
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <h2 className="mb-2 text-2xl font-semibold">Outreach</h2>
      <p className="mb-6 text-sm text-gray-500">{total} total messages</p>
      <OutreachTable
        messages={messages}
        page={page}
        totalPages={totalPages}
      />
    </div>
  );
}
