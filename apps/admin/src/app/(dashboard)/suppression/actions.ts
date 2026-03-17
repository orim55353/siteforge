"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function addSuppression(email: string, reason: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;

  await prisma.suppressionEntry.upsert({
    where: { email: normalized },
    update: { reason, source: "admin" },
    create: { email: normalized, reason, source: "admin" },
  });

  revalidatePath("/suppression");
}

export async function removeSuppression(id: string) {
  await prisma.suppressionEntry.delete({ where: { id } });
  revalidatePath("/suppression");
}
