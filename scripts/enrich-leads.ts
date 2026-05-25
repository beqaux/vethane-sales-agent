import { loadEnv } from "./_env";
loadEnv();

import { leadRepo } from "../lib/db/repositories/lead";
import { eventRepo } from "../lib/db/repositories/event";
import { createEnrichmentService } from "../lib/services/enrichment";

// Kullanım: pnpm tsx scripts/enrich-leads.ts
async function main(): Promise<void> {
  const svc = createEnrichmentService({ leads: leadRepo, events: eventRepo });
  const adaylar = await leadRepo.listByDurum("aday", 2000);
  let ok = 0;
  let no = 0;
  let skip = 0;
  for (const lead of adaylar) {
    if (lead.email) {
      skip++;
      continue;
    }
    if (!lead.website) {
      no++;
      continue;
    }
    const r = await svc.enrichLead(lead);
    if (r.email) {
      ok++;
      console.log(`✓ ${lead.kurumAdi}: ${r.email} (${r.confidence})`);
    } else {
      no++;
    }
  }
  console.log(`\nZenginleştirildi: ${ok} · e-posta bulunamadı: ${no} · zaten vardı: ${skip}`);
  console.log("Sonra: 'pnpm tsx scripts/export-candidates.ts' ile adayları incele/onayla.");
  process.exit(0);
}

main().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
