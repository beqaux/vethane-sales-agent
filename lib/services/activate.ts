import type { LeadRepo, SequenceRepo } from "../domain/ports";

/** Lead'i sekansa hazır hale getir: durum=yeni + sekans yoksa oluştur (hemen due). */
export async function activateLead(
  leads: LeadRepo,
  seq: SequenceRepo,
  leadId: string,
): Promise<void> {
  await leads.updateDurum(leadId, "yeni");
  const existing = await seq.get(leadId);
  if (!existing) await seq.create(leadId);
}
