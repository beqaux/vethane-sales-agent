/**
 * Gelen (inbound) test verisini sıfırlar: kaynak='inbound' lead'leri + cascade
 * (messages, sequence_state, pending_actions) siler; o e-postaları suppression'dan
 * temizler. Sourced/cold lead'ler (kaynak != 'inbound', örn. animalistan) KORUNUR.
 * events tablosu (leadId set-null) audit olarak kalır.
 *
 * Kullanım:
 *   node --import tsx scripts/reset-inbound-test-data.ts            # DRY-RUN (hiçbir şey silinmez)
 *   node --import tsx scripts/reset-inbound-test-data.ts --execute  # gerçekten siler
 */
import { loadEnv } from "./_env";
loadEnv(".env");
loadEnv(".env.local");

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../lib/db/client";
import { leads, messages, suppression } from "../lib/db/schema";

const EXECUTE = process.argv.includes("--execute");

async function main(): Promise<void> {
  const toDelete = await db
    .select({
      id: leads.id,
      email: leads.email,
      kurumAdi: leads.kurumAdi,
      segment: leads.segment,
      durum: leads.durum,
    })
    .from(leads)
    .where(eq(leads.kaynak, "inbound"));

  const preserved = await db
    .select({ email: leads.email, kurumAdi: leads.kurumAdi, kaynak: leads.kaynak })
    .from(leads)
    .where(sql`${leads.kaynak} IS DISTINCT FROM 'inbound'`);

  const ids = toDelete.map((l) => l.id);
  const emails = toDelete
    .map((l) => l.email?.toLowerCase().trim())
    .filter((e): e is string => !!e);

  const msgCount = ids.length
    ? (
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(messages)
          .where(inArray(messages.leadId, ids))
      )[0]?.n ?? 0
    : 0;

  console.log(`\n=== SİLİNECEK — kaynak='inbound' test lead'leri: ${toDelete.length} (≈${msgCount} mesaj) ===`);
  for (const l of toDelete) {
    console.log(`  - ${l.email ?? "(email yok)"} | ${l.kurumAdi} | ${l.segment}/${l.durum} | ${l.id.slice(0, 8)}`);
  }
  console.log(`\n=== KORUNACAK — kaynak != 'inbound': ${preserved.length} ===`);
  for (const l of preserved) {
    console.log(`  - ${l.email ?? "(email yok)"} | ${l.kurumAdi} | kaynak=${l.kaynak ?? "null"}`);
  }

  if (!EXECUTE) {
    console.log(`\n[DRY-RUN] Hiçbir şey silinmedi. Onaylıyorsan: --execute ile çalıştır.`);
    return;
  }

  if (ids.length === 0) {
    console.log(`\nSilinecek inbound lead yok.`);
    return;
  }
  // leads silindiğinde messages/sequence_state/pending_actions cascade ile gider.
  await db.delete(leads).where(inArray(leads.id, ids));
  if (emails.length) {
    await db.delete(suppression).where(inArray(suppression.email, emails));
  }
  console.log(`\n✅ ${ids.length} inbound test lead'i + cascade (mesaj/sekans/pending) + ${emails.length} suppression kaydı silindi.`);
}

main().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
