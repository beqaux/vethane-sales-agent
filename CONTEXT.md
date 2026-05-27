# Vethane Satış Ajanı (`saas-seller`) — Karar Özeti & Mimari Plan

> **Durum:** Grilling ile karara bağlandı (2026-05-25). Tüm büyük mimari dallar çözüldü.
> **Amaç:** Vethane'i (veteriner işletme yönetimi SaaS'ı) **kurucu yerine** satan, yarı-otonom bir AI satış ajanı. Cold outbound + inbound cevap yönetimi, insan-onaylı.
> **İlke:** Kurucu pazardan az kişi tanıyor ve kimseye minnet duymak istemiyor → satışı insan ağı yerine **kendi sahip olduğu yazılımla** yürütür.

---

## 0. TL;DR

İki modlu bir AI satış ajanı:
- **Outbound:** Küratörlü lead DB'sinden hedef kliniklere kişiselleştirilmiş cold mail sekansı atar (insan-onaylı taslaklar).
- **Inbound:** Gelen cevapları sınıflar, segmente göre yanıt taslağı üretir, demo isteğinde kurucuya Telegram'dan haber verir.
- **Yüzey:** Gmail-yerel (taslak = onay kuyruğu, etiket = pipeline). Web UI sonraya.
- **Stack:** Vercel + Next.js + Neon Postgres + AI SDK v6/Gateway (Claude).

**Gerçekçi beklenti:** Bu bir **isabet oyunu, hacim oyunu değil.** ~250 yüksek-değerli hedef → iyi kişiselleştirme + takip ile ~%5-15 yanıt → ~15-35 yanıt → bir avuç demo. ARPA ₺11-22k olduğu için **birkaç kapanış bile** viability'e ciddi katkı.

---

## 1. Çözülen Kararlar (Karar Ağacı)

| # | Karar | Seçim | Gerekçe |
|---|---|---|---|
| 1 | **Ürün/pazar/satış modeli** | Vethane = vet **işletme yönetimi**; GTM **hedefli, kademeli**: Tier1=250 premium (poliklinik+hastane) öncelik → veriyle Tier2=~770 (3-5 vet); solo=self-servis inbound (cold değil) | Para+acı+moat orada zirve; tek domain ~250'yi kaldırır, 9.637'yi kaldırmaz (deliverability) |
| 2 | **Ajan rolü** | **Çift-modlu:** solo → açık fiyat + trial; mid/hastane → fiyat YOK, keşif + **sistem demosu** + bildirim. **Demo = fake-data ürün-tour'u** (harcama sorusu/teklif YOKTUR); harcama keşfi ve teklif **demo sonrası ayrı bir kurucu görüşmesinde** yapılır (2-adımlı satış: demo → teklif görüşmesi). | Otomatik fiyat-cevabı mid/hastane değer-satışını baltalamasın; demo sürtünmesiz olsun, derin keşif insan-insana. **Not (2026-05-26):** Demo tanımı netleştirildi — `docs/PRICING.md §10` ve `lib/config/playbooks.ts` mesajlarındaki "demoda net teklif" ifadeleri bu doğrultuda güncellenecek. |
| 3 | **Lead kaynağı** | **Yarı-otomatik küratörlük** → lead DB | 250 hedef küçük & sonlu; kalite > nicelik |
| 4 | **Otonomi** | **Onaylı başla**, düşük-riskli aksiyonları kademeli auto'ya al | Domain itibarı + 250 "hayal hesabı" korunur |
| 5 | **E-posta altyapı** | info@vethane.com'u **Google Workspace**'e taşı (iCloud'dan) | iCloud'un API'si yok, ToS-lockout riski; Workspace = API + push + Taslaklar-kuyruğu |
| 6 | **Yüzey** | **Gmail-yerel** (taslak=onay, etiket=pipeline), UI sonra; Telegram dar onay shortcut'u tamamlayıcı (ADR-0006) | En hızlı değer, en az bakım; backend aynı kaldığı için UI sonradan eklenir |
| 7 | **Bildirim + onay yüzeyi** | **Telegram bot (çift-yön)** | Tek-yön bildirim + dar inline-button onay yüzeyi (3 yer: cold premium taslak, demo saat onayı, belirsiz cevap taslağı). Gmail-yerel ana yüzey kalır. **ADR-0006.** |
| 8 | **AI & kural** | **Yapısal kaynak + AI sadece ifade eder** + RAG + kod-seviyesi guardrail | Fiyat/söz halüsinasyonu engellenir |
| 9 | **Uyumluluk** | **B2B muafiyeti** (tacir/esnaf → opt-in yok) + opt-out + suppression + net kimlik, baştan | Yasal + deliverability dostu |
| 10 | **Outbound akış** | **Çok-dokunuşlu sekans** (ilk + 2-3 takip, 3-5 gün ara) + düşük hacim warmup + karar-verici-bilinçli | Cevapların çoğu takiplere gelir; yeni domain ısınma ister |
| 11 | **Stack** | **Vercel + Next.js + Neon + AI SDK**; inbound=Pub/Sub push; cron=Vercel Cron; sekans=`next_action_at`+cron; OAuth=Workspace-Internal | İş yükü minik → managed + az bakım kazanır; lock-in düşük |

---

## 2. Mimari

### Outbound döngüsü
1. **Vercel Cron** (saatlik/günlük) → `next_action_at <= now` ve `status=active` olan lead'leri çek.
2. Her gönderimden önce **suppression kontrolü**.
3. **AI (Claude Sonnet)** segment-bilinçli playbook ile kişisel taslak yazar.
4. **Kod guardrail** taslağı doğrular (mid/hastane'de sayı yok, söz yok, opt-out satırı var).
5. **Gmail API** ile taslak oluştur + lead'i etiketle (`vethane/sekansta`).
6. Kurucu Gmail'de **onayla → Gönder** (v1). Gönderim DB'ye işlenir, `next_action_at` bir sonraki dokunuşa kurulur.

### Inbound döngüsü
1. **Gmail Pub/Sub push** → Vercel webhook → `history.list` ile yeni mesaj.
2. **AI (Claude Haiku)** sınıflar: `fiyat | demo | ilgili | ilgisiz | oto_yanıt | çıkış`.
3. **Segment tespiti** (lead DB'den `tür+vet_sayısı`; DB'de yoksa içerikten çıkar).
4. Playbook'a yönlendir:
   - **solo + fiyat** → pricing config'ten fiyat çek + trial linki taslağı
   - **mid/hastane** → keşif sorusu + demo-pivotu taslağı (**fiyat YOK**)
   - **demo** → **Telegram bildirim** + randevu taslağı + `status=demo_istedi`
   - **çıkış** → suppression'a ekle + sekansı durdur
5. Taslak Gmail'e (onay) + ilgili etiket. Cevap gelmesi sekansı **otomatik durdurur**.

### Bileşenler
- **Vercel Functions:** cron handler'lar + Pub/Sub webhook + (sonra) UI API.
- **Neon Postgres:** runtime durum (aşağıdaki şema).
- **AI SDK v6 + Gateway:** Sonnet (taslak) / Haiku (sınıflama).
- **Entegrasyon:** Gmail API (OAuth Internal), Telegram Bot API, (ops.) Google Calendar.
- **Config (repo'da, versiyonlu, tek gerçek kaynak):** `pricing`, `modules`, `playbooks`, guardrail kuralları.
- **RAG verisi:** Vethane konumlandırma/FAQ (ADR/CONTEXT'ten türetilmiş).

---

## 3. Veri Modeli (taslak)

```
leads(id, kurum_adi, sehir, tur[poliklinik|hastane|muayenehane], vet_sayisi?,
      segment[solo|mid|hospital], email, website?, karar_verici?, kaynak,
      durum[yeni|sekansta|cevap_geldi|demo_istedi|kazanildi|kaybedildi|cikti],
      gmail_thread_id?, created_at, updated_at)

sequence_state(lead_id, current_step[0..3], next_action_at, last_sent_at,
      status[active|paused|stopped_replied|stopped_optout|completed])

messages(id, lead_id, direction[out|in], gmail_message_id, subject, body,
      classification?, status[draft|approved|sent], created_at)

suppression(email, reason[optout|bounce|manual], created_at)

events(id, lead_id, type, payload_json, created_at)   -- audit/gözlemlenebilirlik
```

**Segment türetme (tür-öncelikli, 2026-05-26 güncellendi):**
1. **Ünvanında `HASTANE`** varsa → her zaman `hospital` (vet sayısına bakma).
2. **Ünvanında `POLİKLİNİK`** varsa → `vet_sayisi>=6 → hospital`, aksi `mid` (yasayla ≥4 vet zaten).
3. **Ünvanında `MUAYENEHANE`** varsa → `vet_sayisi<=2 → solo`, `=3 → mid` (yasayla ≤3 vet).
4. **Tür belirsiz / ünvanda anahtar yok** → vet sayısına düş: `≥6 → hospital`, `3-5 → mid`, `1-2 → solo`.
5. **Hiçbir sinyal yok** (örn. web inbound) → `unknown`; sonraki sinyallerle (kurumsal domain + keyword + AI guess + cevap-içinden sayı extract) güncelle.

**Detection katmanları (öncelik sırası):**
- Sourcing-anı: Places API + web kazıma → tür, vet sayısı, şube sayısı lead DB'ye yazılır.
- Web inbound: body/subject keyword (`hastane|poliklinik|şube|merkez|zincir` → premium eğilim) + AI `segmentGuess` (Haiku, prompt'a `fromEmail` eklenmeli — şu an eklenmemiş) + cevap-içinden sayı regex.
- İlk cevap sonrası: "kaç vet?" cevabını parse, segment hard-set.

> **Not:** `fromEmail` domaini (free-mail vs kurumsal) **segment kararına girmez** (2026-05-26 kararı). TR'de küçük-orta klinikler genelde Gmail/Hotmail kullanıyor; domain güvenilir bir bant sinyali değil. Sadece event log'una yazılır.

---

## 4. Guardrail'ler (her outbound taslakta kod-seviyesi doğrulama)

- `segment ∈ {mid, hospital}` ise: taslakta **fiyat-benzeri sayı** (₺, "TL", para regex) varsa **reddet** → keşif/demo pivotuna zorla.
- İndirim/taahhüt/garanti ifadeleri (onaylı kalıplar dışında) → **reddet**.
- Her cold outbound'da **opt-out satırı** zorunlu.
- Gönderimden önce **suppression** kontrolü zorunlu.
- Solo fiyat cevabı: yalnız `pricing` config lookup'tan **literal** enjekte edilir; AI sayıyı değiştiremez.

---

## 5. v1 İnşa Planı (fazlar)

**Faz 0 — Temel kurulum (hesaplar; çoğu kurucu tarafından):**
- info@vethane.com → Google Workspace migrasyonu
- Google Cloud projesi: OAuth (Internal) + Gmail API + Pub/Sub topic + push subscription
- Neon DB, Telegram bot (token + chat_id), Vercel projesi
- Repo iskeleti (Next.js App Router) + env/secrets

**Faz 1 — Outbound (insan-onaylı):**
- DB şeması + seed CSV (20-50 bilinen klinik) + curation pipeline taslağı
- `pricing`/`modules`/`playbooks` config
- AI taslak (Sonnet) segment-aware + guardrail doğrulama
- Gmail draft + etiket; sekans state + Vercel Cron (due sends + watch yenileme)
- Compliance: opt-out satırı + suppression

**Faz 2 — Inbound:**
- Pub/Sub webhook → history.list → sınıflama (Haiku) → segment route → playbook taslağı
- Telegram bildirim (demo/hot sinyal); çıkış → suppression + sekans durdur

**Faz 3 — Olgunlaşma:**
- Düşük-riskli aksiyonları auto'ya al (~10 düzeltmesiz onay sonrası: solo fiyat-cevabı + takipler)
- Günlük Telegram özeti (gönderildi/cevap/demo)
- (Ops.) Google Calendar ile demo slot önerisi; (Ops.) ince web paneli

---

## 6. Açık Kalan Küçük Kararlar (v1 varsayılanları — değiştirilebilir)

| Kalem | v1 Varsayılan | Alternatif |
|---|---|---|
| Demo randevusu | Telegram inline-button onayı (literal saat alıntısı echo'lu confirmation maili, "link 15 dk önce iletilir") | Calendar entegrasyonu demo volume artınca (Faz-3+) — ADR-0006 |
| Auto'ya geçiş kriteri | ~10 düzeltmesiz onay sonrası (solo fiyat + takip; mid/hospital_**takip** ADR-0006 ile auto'ya alındı, **cold** premium hala manuel + Telegram button) | Manuel toggle |
| Seed liste | Kurucu 20-50 klinik verir, pipeline büyütür | Tam scraper Faz-2 |
| Metrikler | DB + günlük Telegram özeti | Web dashboard (sonra) |

---

## 7. Bağımlılıklar / Dış Gereksinimler (kurucu)
- Google Workspace aboneliği (~$7/ay) + DNS erişimi (vethane.com)
- Google Cloud projesi (OAuth + Pub/Sub) — ücretsiz katman yeterli
- Neon + Vercel hesapları (bu hacimde ~bedava)
- AI Gateway / Anthropic API anahtarı
- Telegram hesabı
