import { loadEnv } from "./_env";
loadEnv();

import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { leadRepo } from "../lib/db/repositories/lead";
import { sequenceRepo } from "../lib/db/repositories/sequence";
import { suppressionRepo } from "../lib/db/repositories/suppression";
import { activateLead } from "../lib/services/activate";
import { parseSeedRow, type SeedRow } from "../lib/services/import";

// Kullanım: pnpm tsx scripts/import-seed.ts data/seed.csv
// CSV başlıkları: kurum_adi,sehir,tur,vet_sayisi,email,website,karar_verici,kaynak
async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error("Kullanım: pnpm tsx scripts/import-seed.ts <dosya.csv>");
    process.exit(1);
  }
  const csv = readFileSync(file, "utf8");
  const parsed = Papa.parse<SeedRow>(csv, { header: true, skipEmptyLines: true });

  let imported = 0;
  let candidates = 0;
  let skipped = 0;
  let suppressed = 0;

  for (const row of parsed.data) {
    const p = parseSeedRow(row);
    if (!p.ok) {
      console.warn(`atlandı (${p.reason})`);
      skipped++;
      continue;
    }
    const lead = p.lead;
    const email = lead.email;

    if (email) {
      if (await suppressionRepo.has(email)) {
        await leadRepo.upsertByEmail({ ...lead, email, durum: "cikti" });
        suppressed++;
        continue;
      }
      const saved = await leadRepo.upsertByEmail({ ...lead, email, durum: "yeni" });
      await activateLead(leadRepo, sequenceRepo, saved.id);
      imported++;
    } else {
      await leadRepo.upsertCandidate({
        kurumAdi: lead.kurumAdi,
        sehir: lead.sehir ?? null,
        tur: lead.tur ?? null,
        website: lead.website ?? null,
        phone: null,
        placeId: null,
        kaynak: lead.kaynak ?? "seed",
        segment: lead.segment ?? "unknown",
        tier: lead.tier ?? 3,
        email: null,
      });
      candidates++;
    }
  }

  console.log(
    `İçe alındı (aktif): ${imported} · aday (e-postasız): ${candidates} · atlanan: ${skipped} · suppression: ${suppressed}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
