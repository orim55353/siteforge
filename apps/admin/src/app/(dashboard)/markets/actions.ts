"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function addMarket(industry: string, city: string, state: string) {
  const normalized = {
    industry: industry.trim().toLowerCase(),
    city: city.trim(),
    state: state.trim().toUpperCase(),
  };

  if (!normalized.industry || !normalized.city || !normalized.state) return;

  const name = `${normalized.industry.charAt(0).toUpperCase() + normalized.industry.slice(1)} in ${normalized.city}, ${normalized.state}`;

  await prisma.market.upsert({
    where: {
      industry_city_state: {
        industry: normalized.industry,
        city: normalized.city,
        state: normalized.state,
      },
    },
    update: { active: true, name },
    create: {
      name,
      industry: normalized.industry,
      city: normalized.city,
      state: normalized.state,
    },
  });

  revalidatePath("/markets");
}

export async function toggleMarketActive(id: string, active: boolean) {
  await prisma.market.update({
    where: { id },
    data: { active },
  });

  revalidatePath("/markets");
}

export async function deleteMarket(id: string) {
  // Only delete if no businesses are linked
  const businessCount = await prisma.business.count({
    where: { marketId: id },
  });

  if (businessCount > 0) {
    // Deactivate instead of deleting to preserve history
    await prisma.market.update({
      where: { id },
      data: { active: false },
    });
  } else {
    await prisma.market.delete({ where: { id } });
  }

  revalidatePath("/markets");
}
