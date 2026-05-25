import { eq } from "drizzle-orm";
import { db } from "../client";
import { suppression } from "../schema";
import type { SuppressionRepo } from "../../domain/ports";

const norm = (e: string) => e.toLowerCase().trim();

export const suppressionRepo: SuppressionRepo = {
  async has(email) {
    const rows = await db
      .select({ email: suppression.email })
      .from(suppression)
      .where(eq(suppression.email, norm(email)))
      .limit(1);
    return rows.length > 0;
  },
  async add(email, reason) {
    await db
      .insert(suppression)
      .values({ email: norm(email), reason })
      .onConflictDoNothing();
  },
};
