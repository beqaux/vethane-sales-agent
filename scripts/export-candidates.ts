import { loadEnv } from "./_env";
loadEnv();

import { readFileSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
import { leadRepo } from "../lib/db/repositories/lead";
import { sequenceRepo } from "../lib/db/repositories/sequence";
import { activateLead } from "../lib/services/activate";

const OUT = "candidates.csv";

async function list(): Promise<void> {
  const adaylar = await leadRepo.listByDurum("aday", 5000);
  const withEmail = adaylar.filter((l) => l.email);
  const rows = withEmail.map((l) => ({
    kurum_adi: l.kurumAdi,
    sehir: l.sehir,
    tur: l.tur,
    segment: l.segment,
    tier: l.tier,
    email: l.email,
    email_confidence: l.emailConfidence,
    website: l.website,
  }));
  writeFileSync(OUT, Papa.unparse(rows), "utf8");
  const lowConf = withEmail.filter((l) => l.emailConfidence === "low").length;
  console.log(`${withEmail.length} aday (e-postalı) ${OUT}'ye yazıldı.`);
  if (lowConf) console.log(`⚠️ ${lowConf} tanesi düşük güvenli (info@domain tahmini) — doğrula.`);
  console.log(`İncele, kötüleri sil/düzelt, sonra: pnpm tsx scripts/export-candidates.ts --approve ${OUT}`);
}

async function approve(file: string): Promise<void> {
  const csv = readFileSync(file, "utf8");
  const parsed = Papa.parse<{ email?: string }>(csv, { header: true, skipEmptyLines: true });
  let activated = 0;
  let missing = 0;
  for (const row of parsed.data) {
    const email = (row.email ?? "").trim().toLowerCase();
    if (!email) continue;
    const lead = await leadRepo.byEmail(email);
    if (!lead) {
      missing++;
      continue;
    }
    await activateLead(leadRepo, sequenceRepo, lead.id);
    activated++;
  }
  console.log(`Aktive edilen (durum=yeni + sekans): ${activated} · bulunamayan: ${missing}`);
}

async function main(): Promise<void> {
  if (process.argv[2] === "--approve") {
    const file = process.argv[3];
    if (!file) {
      console.error("Kullanım: pnpm tsx scripts/export-candidates.ts --approve <dosya.csv>");
      process.exit(1);
    }
    await approve(file);
  } else {
    await list();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
