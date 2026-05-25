import { eq } from "drizzle-orm";
import { db } from "../client";
import { sequenceState } from "../schema";
import { toSeq } from "../mappers";
import type { SequenceRepo } from "../../domain/ports";

export const sequenceRepo: SequenceRepo = {
  async get(leadId) {
    const [row] = await db
      .select()
      .from(sequenceState)
      .where(eq(sequenceState.leadId, leadId))
      .limit(1);
    return row ? toSeq(row) : null;
  },
  async create(leadId) {
    // nextActionAt = now → yeni lead hemen "due" olur (ilk dokunuş).
    const [row] = await db
      .insert(sequenceState)
      .values({ leadId, nextActionAt: new Date() })
      .returning();
    return toSeq(row);
  },
  async save(s) {
    const set = {
      currentStep: s.currentStep,
      nextActionAt: s.nextActionAt,
      lastSentAt: s.lastSentAt,
      status: s.status,
    };
    await db
      .insert(sequenceState)
      .values({ leadId: s.leadId, ...set })
      .onConflictDoUpdate({ target: sequenceState.leadId, set });
  },
};
