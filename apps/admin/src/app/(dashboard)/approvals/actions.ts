"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function approveBusinesses(ids: string[]) {
  if (ids.length === 0) return;

  await prisma.business.updateMany({
    where: {
      id: { in: ids },
      status: "qualified",
      approvedAt: null,
    },
    data: {
      approvedAt: new Date(),
      approvedBy: "admin",
    },
  });

  // Note: The page-gen worker listens for approved businesses.
  // Status will transition to page_generated when the worker picks them up.

  revalidatePath("/approvals");
  revalidatePath("/");
}

export async function rejectBusinesses(ids: string[]) {
  if (ids.length === 0) return;

  await prisma.business.updateMany({
    where: {
      id: { in: ids },
      status: "qualified",
    },
    data: {
      status: "disqualified",
    },
  });

  revalidatePath("/approvals");
  revalidatePath("/");
}
