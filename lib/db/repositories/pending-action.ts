import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../client";
import { pendingActions } from "../schema";
import { toPendingAction } from "../mappers";
import type { PendingActionRepo } from "../../domain/ports";

// ADR-0006 §2.5: Telegram callback yüzeyinin durum tablosu repo'su.
export const pendingActionRepo: PendingActionRepo = {
  async create(input) {
    const values = {
      ...(input.id ? { id: input.id } : {}),
      kind: input.kind,
      leadId: input.leadId,
      gmailDraftId: input.gmailDraftId,
      gmailThreadId: input.gmailThreadId,
      payload: input.payload ?? {},
      expiresAt: input.expiresAt,
      ...(input.status ? { status: input.status } : {}),
    } satisfies Partial<typeof pendingActions.$inferInsert>;
    const [row] = await db.insert(pendingActions).values(values).returning();
    return toPendingAction(row);
  },

  async byId(id) {
    const [row] = await db
      .select()
      .from(pendingActions)
      .where(eq(pendingActions.id, id))
      .limit(1);
    return row ? toPendingAction(row) : null;
  },

  async byPrefix(prefix) {
    // UUID v4 hex prefix lookup. 8-char prefix = 2^32 namespace; max 1000 concurrent
    // pending varsayımında çarpışma <10^-6 (ADR-0006 §3.3).
    const [row] = await db
      .select()
      .from(pendingActions)
      .where(
        and(
          sql`${pendingActions.id}::text LIKE ${prefix + "%"}`,
          eq(pendingActions.status, "pending"),
        ),
      )
      .limit(1);
    return row ? toPendingAction(row) : null;
  },

  async resolve(id, finalStatus) {
    // Atomic CAS — concurrent çağrılarda yarış kazananı bir tane.
    const res = await db
      .update(pendingActions)
      .set({ status: finalStatus, resolvedAt: new Date() })
      .where(
        and(eq(pendingActions.id, id), eq(pendingActions.status, "pending")),
      )
      .returning({ id: pendingActions.id });
    return res.length === 1;
  },

  async updatePayload(id, patch) {
    // jsonb concat: mevcut anahtarlar üzerine yazılır, kalanlar korunur.
    await db
      .update(pendingActions)
      .set({ payload: sql`${pendingActions.payload} || ${JSON.stringify(patch)}::jsonb` })
      .where(eq(pendingActions.id, id));
  },

  async expireDue(now) {
    const res = await db
      .update(pendingActions)
      .set({ status: "expired", resolvedAt: now })
      .where(and(eq(pendingActions.status, "pending"), lt(pendingActions.expiresAt, now)))
      .returning({ id: pendingActions.id });
    return res.length;
  },
};
