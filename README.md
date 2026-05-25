# Vethane Satış Ajanı (`saas-seller`)

Vethane'i (TR veteriner işletme yönetimi SaaS'ı) kurucu yerine satan, **çift-modlu, insan-onaylı, Gmail-yerel** AI satış ajanı.

- **Outbound:** küratörlü lead DB'sinden çok-dokunuşlu kişisel cold mail sekansı (Gmail taslağı → kurucu onaylar).
- **Inbound:** gelen cevapları sınıflar/yanıtlar — solo → açık fiyat+trial; mid/hastane → fiyat YOK, keşif+demo; demo → Telegram bildirim.

## Dokümanlar
- [`CONTEXT.md`](./CONTEXT.md) — kararlar (grilling)
- [`docs/SPECIFICATION.md`](./docs/SPECIFICATION.md) — ne
- [`docs/IMPLEMENTATION.md`](./docs/IMPLEMENTATION.md) — nasıl
- [`docs/TASKS.md`](./docs/TASKS.md) — iş kalemleri
- [`docs/PROMPT.md`](./docs/PROMPT.md) — tek-atış build prompt'u
- [`docs/SETUP.md`](./docs/SETUP.md) — Faz-0 hesap kurulumu (kurucu)

## Stack
Next.js 16 (App Router) · Neon Postgres + Drizzle · AI SDK v6 + Vercel AI Gateway (Claude) · googleapis (Gmail/Pub-Sub) · grammy (Telegram) · Vercel (Fluid Compute + Cron).

## Geliştirme
```bash
pnpm install
cp .env.example .env        # değerleri doldur (bkz. docs/SETUP.md)
pnpm db:migrate             # Neon şeması
pnpm tsx scripts/setup-gmail-watch.ts   # bir kez: OAuth + watch (kod Step 6'dan sonra)
pnpm dev
```

## Operasyonel akış (canlı)
```bash
# 1) Lead bul (Places + sicil)
pnpm tsx scripts/source-leads.ts İstanbul İzmir Ankara
# 2) E-posta zenginleştir (website kazıma)
pnpm tsx scripts/enrich-leads.ts
# 3) Adayları dışa al → candidates.csv'yi incele, kötüleri sil/düzelt
pnpm tsx scripts/export-candidates.ts
# 4) Onayla (KÜRATÖRLÜK KAPISI) → durum=yeni + sekans başlar
pnpm tsx scripts/export-candidates.ts --approve candidates.csv
```
Sonra cron'lar devralır: **outbound** (günlük 09:00) AI taslağı üretir → **sen Gmail'de onaylar/gönderirsin**; **gelen cevaplar** webhook + poll ile sınıflanır, demo'da Telegram'a bildirim düşer.

> ⚠️ Cron sıklığı (saatlik altı poll) için Vercel **Pro** gerekir. Seed alternatifi: `pnpm tsx scripts/import-seed.ts data/seed.csv`.

## Komutlar
`pnpm dev | build | lint | typecheck | test | db:generate | db:migrate`

> Çalıştırma için Faz-0 hesap kurulumu (`docs/SETUP.md`) tamamlanmalı.
