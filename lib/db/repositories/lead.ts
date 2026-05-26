import { and, eq, lte, inArray, isNotNull, asc, sql } from "drizzle-orm";
import { db } from "../client";
import { leads, sequenceState } from "../schema";
import { toLead, toSeq } from "../mappers";
import type { LeadRepo } from "../../domain/ports";
import type { Lead } from "../../domain/types";

const norm = (e: string) => e.toLowerCase().trim();

export const leadRepo: LeadRepo = {
  async dueForSend(now, tiers, limit) {
    if (tiers.length === 0) return [];
    const rows = await db
      .select()
      .from(leads)
      .innerJoin(sequenceState, eq(sequenceState.leadId, leads.id))
      .where(
        and(
          eq(sequenceState.status, "active"),
          lte(sequenceState.nextActionAt, now),
          inArray(leads.tier, tiers),
          isNotNull(leads.email),
        ),
      )
      .orderBy(asc(sequenceState.nextActionAt))
      .limit(limit);
    return rows.map((r) => ({ ...toLead(r.leads), seq: toSeq(r.sequence_state) }));
  },

  async byId(id) {
    const [row] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    return row ? toLead(row) : null;
  },

  async byEmail(email) {
    const [row] = await db.select().from(leads).where(eq(leads.email, norm(email))).limit(1);
    return row ? toLead(row) : null;
  },

  async byThread(threadId) {
    const [row] = await db
      .select()
      .from(leads)
      .where(eq(leads.gmailThreadId, threadId))
      .limit(1);
    return row ? toLead(row) : null;
  },

  async upsertByEmail(input) {
    const email = norm(input.email);
    const values = {
      kurumAdi: input.kurumAdi ?? "",
      sehir: input.sehir,
      tur: input.tur,
      vetSayisi: input.vetSayisi,
      segment: input.segment,
      tier: input.tier,
      email,
      emailConfidence: input.emailConfidence,
      website: input.website,
      placeId: input.placeId,
      phone: input.phone,
      instagram: input.instagram,
      kararVerici: input.kararVerici,
      kaynak: input.kaynak,
      durum: input.durum,
      gmailThreadId: input.gmailThreadId,
      updatedAt: new Date(),
    } satisfies Partial<typeof leads.$inferInsert>;

    // Güncellemede undefined alanları atla (mevcut değeri ezme).
    const set: Partial<typeof leads.$inferInsert> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== undefined) (set as Record<string, unknown>)[k] = v;
    }

    const [row] = await db
      .insert(leads)
      .values(values)
      .onConflictDoUpdate({ target: leads.email, set })
      .returning();
    return toLead(row);
  },

  async updateDurum(id, durum) {
    await db.update(leads).set({ durum, updatedAt: new Date() }).where(eq(leads.id, id));
  },

  async setThread(id, threadId) {
    await db
      .update(leads)
      .set({ gmailThreadId: threadId, updatedAt: new Date() })
      .where(eq(leads.id, id));
  },

  async upsertCandidate(c) {
    const base = {
      kurumAdi: c.kurumAdi,
      sehir: c.sehir,
      tur: c.tur,
      segment: c.segment,
      tier: c.tier,
      website: c.website,
      phone: c.phone,
      placeId: c.placeId,
      kaynak: c.kaynak,
      email: c.email ?? null,
      durum: "aday" as const,
      updatedAt: new Date(),
    } satisfies Partial<typeof leads.$inferInsert>;
    if (c.placeId) {
      const [row] = await db
        .insert(leads)
        .values(base)
        .onConflictDoUpdate({
          target: leads.placeId,
          set: { website: c.website, phone: c.phone, sehir: c.sehir, updatedAt: new Date() },
        })
        .returning();
      return toLead(row);
    }
    const [row] = await db.insert(leads).values(base).returning();
    return toLead(row);
  },

  async listByDurum(durum, limit = 1000) {
    const rows = await db.select().from(leads).where(eq(leads.durum, durum)).limit(limit);
    return rows.map(toLead);
  },

  async setEmail(id, email, confidence) {
    await db
      .update(leads)
      .set({ email: norm(email), emailConfidence: confidence, updatedAt: new Date() })
      .where(eq(leads.id, id));
  },

  async byDomain(domain) {
    const d = domain.toLowerCase();
    const rows = await db
      .select()
      .from(leads)
      .where(
        sql`(${leads.email} LIKE ${"%@" + d})
            OR EXISTS (
              SELECT 1 FROM unnest(${leads.alternateEmails}) AS ae
              WHERE ae LIKE ${"%@" + d}
            )`,
      )
      .limit(1);
    return rows[0] ? toLead(rows[0]) : null;
  },

  async addAlternateEmail(id, email) {
    const e = norm(email);
    await db
      .update(leads)
      .set({
        alternateEmails: sql`CASE
          WHEN ${e} = ANY(${leads.alternateEmails}) THEN ${leads.alternateEmails}
          ELSE array_append(${leads.alternateEmails}, ${e})
        END`,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, id));
  },
} satisfies LeadRepo;

// Tipi dışa aç (servislerde Lead & {seq} kullanımı için).
export type { Lead };
