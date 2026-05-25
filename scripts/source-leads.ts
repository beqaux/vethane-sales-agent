import { loadEnv } from "./_env";
loadEnv();

import { placesAdapter } from "../lib/adapters/places";
import { leadRepo } from "../lib/db/repositories/lead";
import { eventRepo } from "../lib/db/repositories/event";
import { createSourcingService } from "../lib/services/sourcing";

// Kullanım: pnpm tsx scripts/source-leads.ts İstanbul İzmir Ankara
async function main(): Promise<void> {
  const cities = process.argv.slice(2);
  if (cities.length === 0) {
    console.error("Kullanım: pnpm tsx scripts/source-leads.ts <şehir> [şehir...]");
    process.exit(1);
  }
  const svc = createSourcingService({
    places: placesAdapter,
    leads: leadRepo,
    events: eventRepo,
  });
  for (const city of cities) {
    const r = await svc.sourceCity(city);
    console.log(`${city}: ${r.found} aday bulundu, ${r.upserted} kaydedildi.`);
  }
  console.log("Bitti. 'pnpm tsx scripts/enrich-leads.ts' ile e-posta zenginleştir.");
  process.exit(0);
}

main().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
