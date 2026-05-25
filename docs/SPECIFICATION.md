# Vethane Satış Ajanı — Specification

> Vethane'i (TR veteriner işletme yönetimi SaaS'ı) kurucu yerine satan, çift-modlu, insan-onaylı, Gmail-yerel AI satış ajanı.

> **Kaynak:** Stratejik/mimari kararlar `../CONTEXT.md`'de (grilling, 2026-05-25). Bu belge **ne** inşa edileceğini tanımlar; **nasıl** kısmı IMPLEMENTATION.md'de.

---

## 1. Overview

### 1.1 Vethane Satış Ajanı Nedir?

Vethane Satış Ajanı, Vethane SaaS'ını satmak için **kurucu yerine** çalışan yarı-otonom bir yazılım ajanıdır. İki iş yapar: (1) küratörlü bir hedef klinik listesine **kişiselleştirilmiş cold e-posta sekansları** atar; (2) gelen **cevapları sınıflar ve yanıtlar** — segmente göre ya açık fiyat verip deneme sürümüne yönlendirir ya da fiyat vermeden keşif sorusu sorup demoya çeker, demo isteğinde kurucuyu uyarır.

Çözdüğü problem: Kurucu pazarda az kişi tanıyor ve satışı insan ağına/aracılara minnet ederek yürütmek istemiyor. Bu ajan, satış geliştirme (SDR) işini kurucunun **kendi sahip olduğu, kontrol ettiği** bir yazılıma devreder.

Yaklaşım: Ajan tam otonom değildir. Her giden mail, kurucunun **Gmail'de onayladığı** bir taslak olarak başlar (insan-döngüde). Güven oluştukça düşük-riskli aksiyonlar otomatiğe alınır. Tüm sistem, kurucunun mevcut Gmail/Workspace iş akışının üstünde çalışır; ayrı bir panel gerektirmez (v1).

### 1.2 Hedef Kitle (bu yazılımın kullanıcısı)

**Birincil kullanıcı:** Vethane'in 2 kurucusundan satıştan sorumlu olan(lar) — teknik, solo çalışan, Gmail/Workspace kullanan, satış ekibi olmayan.

**Ajanın hedeflediği alıcılar (lead'ler):** TR'deki veteriner kurumları, GTM önceliğine göre:
- **Birincil:** 3-5 vet poliklinikler + hastaneler (≈250 yüksek-değerli kurum; ARPA ₺11-22k/ay).
- **İkincil:** solo muayenehaneler (1-2 vet) — düşük dokunuş, self-servis funnel.

### 1.3 Temel Farklılaştırıcılar

- **Çift-modlu satış mantığı:** Tek bir "fiyat botu" değil — segmente göre **davranış değiştirir** (solo'ya fiyat verir, mid/hastaneye vermez), kurucunun değer-satışı stratejisini korur.
- **Doğruluk-öncelikli:** Fiyatlar AI tarafından üretilmez, **yapısal config'ten çekilir**; kod-seviyesi guardrail mid/hastane taslağında sayı/söz geçmesini engeller.
- **Tam sahiplik:** Üçüncü-parti cold-mail SaaS'ına (Instantly/lemlist vb.) bağımlı değil; kurucunun kendi domain'i, kendi Gmail'i, kendi DB'si.
- **Sıfır ekstra arayüz (v1):** Onay = Gmail Taslakları, pipeline = Gmail etiketleri, bildirim = Telegram. Yeni alışkanlık gerektirmez.
- **İsabet odaklı:** Hacim değil, ~250 hedefe yüksek kişiselleştirme + çok-dokunuşlu takip.

### 1.4 Rekabet Konumu

| Özellik | Vethane Satış Ajanı | Instantly/Smartlead | Manuel (kurucu elle) | İnsan SDR/ajans |
|---|---|---|---|---|
| Segment-bazlı davranış | ✅ | ❌ (tek şablon) | ✅ (ama yavaş) | ✅ |
| Fiyat doğruluğu garantisi | ✅ (config+guardrail) | ❌ | ✅ | ⚠️ |
| Tam sahiplik / bağımsızlık | ✅ | ❌ (abonelik) | ✅ | ❌ (minnet) |
| Otomatik takip sekansı | ✅ | ✅ | ❌ | ✅ |
| Maliyet (aylık) | ~$7-27 | $$$ | 0 (ama kurucu zamanı) | $$$$ |
| Kurulum eforu | Orta (bir kez) | Düşük | Yok | Yok |

---

## 2. Core Concepts (Domain Sözlüğü)

| Kavram | Tanım |
|---|---|
| **Lead** | Hedef veteriner kurumu kaydı (klinik adı, e-posta, tür, vet sayısı, durum). |
| **Sourcing (Kaynak tarama)** | Hedef kurumları keşfetme: Google Places + resmi sicil (TVHB/Bakanlık). |
| **Enrichment (Zenginleştirme)** | Bir kuruma ait iletişim e-postasını bulma (web sitesi kazıma). |
| **Candidate (Aday)** | Sourcing/enrichment'tan çıkan, kurucu onayı bekleyen ham lead (`durum=aday`). |
| **Segment** | Lead'in büyüklük sınıfı: `solo` (1-2 vet), `mid` (3-5 vet), `hospital` (6+ vet). Davranışı belirler. |
| **Tür** | Kurumun yasal türü: `muayenehane` (≤3 vet), `poliklinik` (≥4 vet), `hastane`. Segment türetmede kullanılır. |
| **Playbook** | Segmente özel davranış scripti (ne söylenir, fiyat verilir mi, hedef aksiyon ne). |
| **Sequence (Sekans)** | Bir lead'e gönderilen sıralı dokunuş dizisi (ilk mail + takipler). |
| **Touch (Dokunuş)** | Sekanstaki tek bir gönderim adımı (step 0 = ilk, 1-3 = takipler). |
| **Discovery pivot** | Mid/hastane'de fiyat yerine sorulan keşif sorusu ("bugün muhasebeci+bordroya ne harcıyorsunuz?"). |
| **Classification (Sınıflama)** | Gelen cevabın etiketi: `fiyat \| demo \| ilgili \| ilgisiz \| oto_yanit \| cikis`. |
| **Approval queue (Onay kuyruğu)** | Kurucunun gönderim öncesi onayladığı taslaklar — fiziksel olarak **Gmail Taslakları**. |
| **Guardrail** | Giden taslağı gönderimden önce doğrulayan kod-seviyesi kural (sayı-blok, söz-blok, opt-out zorunluluğu). |
| **Suppression (Bastırma listesi)** | Bir daha asla mail atılmayacak adresler (çıkış/bounce/manuel). |
| **Hot signal** | Kurucuya anında bildirim gerektiren olay (öncelikle demo isteği). |
| **Warmup (Isınma)** | Yeni gönderim domain'inin itibarını korumak için kademeli artan günlük gönderim limiti. |
| **Source-of-truth config** | Fiyat/modül/playbook gibi kritik verinin tek doğru kaynağı (repo'da versiyonlu dosyalar). |
| **Auto-graduation** | Düşük-riskli bir aksiyon tipinin, yeterli düzeltmesiz onaydan sonra otomatik gönderime alınması. |

---

## 3. Functional Requirements

### 3.1 Lead Yönetimi

**Lead akışı:** Sourcing (3.1.3) → Enrichment (3.1.4) → Aday inceleme (3.1.5) → aktif lead → Segment (3.1.2). Seed import (3.1.1), bu pipeline'ın manuel kısayoludur.

#### 3.1.1 Lead veritabanı & seed import
**User Story:** Kurucu olarak, hedef kliniklerimi tek bir yere koymak istiyorum ki ajan kime mail atacağını bilsin.

**Description:** Lead'ler yapısal bir tabloda tutulur. Kurucu başlangıçta bir **seed CSV** (20-50 bilinen klinik) yükler; sistem CSV'yi parse eder, normalize eder, segment türetir, suppression'a karşı kontrol eder.

**Acceptance Criteria:**
- [ ] CSV import şu alanları kabul eder: kurum_adi, sehir, tur, vet_sayisi?, email, website?, karar_verici?, kaynak.
- [ ] Import sırasında geçersiz/eksik e-posta olan satırlar raporlanır, atlanır.
- [ ] Aynı e-posta iki kez import edilirse tekilleştirilir (upsert).
- [ ] Suppression listesindeki e-postalar import edilse de `durum=cikti` işaretlenir, sekansa alınmaz.

**Edge Cases:** Boş CSV → 0 import, hata yok. `vet_sayisi` boş → segment türden çıkarılır. `tur` tanınmıyorsa → `[TBD]` segment, sekansa alınmaz, kurucuya raporlanır.

**Constraints:** v1'de tam otomatik scraper yok (Non-goal 11.2); seed + manuel/yarı-otomatik zenginleştirme.

#### 3.1.2 Segment tespiti
**User Story:** Ajan olarak, her lead'in segmentini bilmeliyim ki doğru playbook'u seçeyim.

**Acceptance Criteria:**
- [ ] `vet_sayisi >= 6 → hospital`, `3-5 → mid`, `1-2 → solo`.
- [ ] `vet_sayisi` yoksa türden: `hastane → hospital`, `poliklinik → mid`, `muayenehane → solo`.
- [ ] İkisi de yoksa segment `unknown`, lead sekansa alınmaz, kurucuya bildirilir.
- [ ] Gelen cevap, DB'de olmayan bir adresten gelirse segment içerik+imza sinyallerinden tahmin edilir (düşük güven → kurucuya sor).

#### 3.1.3 Lead kaynağı (sourcing / discovery)
**User Story:** Kurucu olarak, hedef ~250 kurumu sıfırdan elle bulmak yerine sistemin aday listesi çıkarmasını istiyorum.

**Description:** Pipeline iki kaynaktan aday kurum üretir:
1. **Google Places API** (Text Search): şehir × sorgu ("veteriner polikliniği", "hayvan hastanesi", "veteriner kliniği") → ad, adres, website, telefon, place_id.
2. **Resmi sicil:** TVHB bölge oda listeleri + Tarım/Orman Bakanlığı ruhsatlı poliklinik/hastane listeleri (yasal ~250'yi tanımlar) → ad, şehir, (varsa) iletişim.

**Acceptance Criteria:**
- [ ] Places sorguları şehir bazında çalıştırılabilir; sonuçlar `place_id` ile tekilleştirilir.
- [ ] Sicil kaynakları (CSV/elle) içe alınıp Places sonuçlarıyla ad+şehir üzerinden eşleştirilir.
- [ ] Çıktı: `durum=aday` lead kayıtları (website/telefon/place_id dolu, e-posta henüz boş olabilir).

**Constraints:** Bir-kerelik / periyodik küratör çalıştırması (sürekli ölçekli scraper değil — §11.2). Google Places ToS + KVKK gözetilir (§8.3).

#### 3.1.4 E-posta zenginleştirme (enrichment)
**User Story:** Aday kurumun iletişim e-postasını elle aramak istemiyorum.

**Description:** Her aday için website varsa: ana sayfa + `/iletisim`/`/contact` sayfaları çekilir; `mailto:` ve e-posta regex ile iletişim adresi çıkarılır.

**Acceptance Criteria:**
- [ ] Website'ten e-posta bulunursa `lead.email` set + `email_confidence=high`.
- [ ] Bulunamaz ama domain varsa `info@<domain>` önerilir + `email_confidence=low`.
- [ ] Hiç e-posta yoksa lead `aday` kalır, "e-posta bulunamadı" işaretlenir; telefon/Instagram fallback olarak saklanır (outreach'e girmez).
- [ ] Çekme nazik yapılır (rate-limit, timeout, robots saygısı); hatalar atlanır + loglanır.

**Constraints:** Yalnız işletmenin **kamuya açık yayınladığı** iletişim adresi (B2B, tacir/esnaf). Üçüncü-parti e-posta bulucu API (Hunter/Snov vb.) v1'de **opsiyonel fallback** — varsayılan değil (bağımsızlık + maliyet).

#### 3.1.5 Aday inceleme (küratörlük kapısı)
**User Story:** Kurucu olarak, 250 premium hesaba mail gitmeden önce listeyi kendim onaylamak istiyorum.

**Acceptance Criteria:**
- [ ] `durum=aday` lead'ler kurucuya sunulur (v1: CSV export / basit liste; UI Future).
- [ ] Kurucu onaylayınca `durum=yeni` → sekansa uygun hale gelir.
- [ ] Reddedilen aday silinir/`kaybedildi`.
- [ ] `email_confidence=low` olanlar onayda işaretlenir (kurucu doğrular).

### 3.2 Outbound Sekans

**Hedefleme tier'ları:** Outbound yalnız `active_tiers` config'indeki tier'ları işler. v1: `[1]` (250 premium). Veriyle Tier 2 (~770, 3-5 vet) açılır; Tier 3 (solo) cold'a alınmaz, self-servis inbound ile gelir. Lead modeli `tier`'ı baştan taşır → genişleme = config değişikliği, refactor değil.

#### 3.2.1 Kişiselleştirilmiş taslak üretimi
**User Story:** Kurucu olarak, her klinik için elle yazmadan kişisel bir cold mail istiyorum.

**Description:** AI (Claude Sonnet), lead verisi + segment playbook'u + Vethane değer önermesi (RAG) ile taslak üretir. Taslak kişiselleştirilir (klinik adı, şehir, varsa karar-verici) ve **karar-vericiye iletilebilir** tonda yazılır (info@ resepsiyona düşebilir).

**Acceptance Criteria:**
- [ ] Taslak konu + gövde içerir, Türkçe, kişiselleştirme alanları dolu.
- [ ] `mid`/`hospital` taslağı **hiçbir fiyat/sayı içermez** (bkz. 3.6.4); keşif/demo pivotu içerir.
- [ ] `solo` taslağı açık fiyatı yalnız config'ten çeker (üretmez) + trial linki içerir.
- [ ] Her cold taslak opt-out satırı içerir.
- [ ] Taslak Gmail'de **taslak** olarak oluşturulur, lead'e ilgili etiket atanır; otomatik gönderilmez (v1).

**Edge Cases:** Lead verisi zayıfsa (sadece e-posta) → genel-ama-segment-uygun taslak, kişiselleştirme alanı atlanır. RAG boş dönerse → temel değer önermesi.

#### 3.2.2 Çok-dokunuşlu sekans & zamanlama
**User Story:** Kurucu olarak, cevap gelmezse otomatik takip istiyorum çünkü cevaplar çoğunlukla takiplerden gelir.

**Acceptance Criteria:**
- [ ] Sekans = ilk mail + 2-3 takip; her dokunuş farklı açı/değer.
- [ ] Takipler 3-5 gün arayla zamanlanır (`next_action_at`).
- [ ] **Cevap gelince sekans otomatik durur** (`stopped_replied`).
- [ ] Çıkış gelince sekans durur + suppression (`stopped_optout`).
- [ ] Son takipten sonra cevap yoksa sekans `completed`.

**Constraints:** Bir lead aynı anda yalnız bir aktif sekansta olur.

#### 3.2.3 Warmup hız limiti
**User Story:** Sistem olarak, yeni domain'i yakmamak için günlük gönderimi sınırlamalıyım.

**Acceptance Criteria:**
- [ ] Günlük yeni-ilk-dokunuş sayısı yapılandırılır bir limitle sınırlanır (başlangıç ~5-10/gün).
- [ ] Limit dolunca kalan lead'ler ertesi güne taşınır.
- [ ] Limit zamanla kademeli artırılabilir (config). `[TBD: kesin ramp; bkz 11.4]`

### 3.3 Onay İş Akışı

#### 3.3.1 Gmail-taslak onayı
**User Story:** Kurucu olarak, giden her maili Gmail'de görüp tek tıkla onaylamak istiyorum.

**Acceptance Criteria:**
- [ ] Her outbound/inbound-yanıt, Gmail'de **taslak** olarak (doğru thread'de) oluşturulur.
- [ ] Kurucu Gmail'de Gönder'e basınca, sistem gönderimi algılar (sonraki polling/push'ta) ve durumu `sent` yapar + `next_action_at`'i kurar.
- [ ] Kurucu taslağı silerse → o dokunuş `rejected`, sekans config'e göre durur veya atlar.
- [ ] Pipeline durumu Gmail etiketleriyle yansıtılır (`vethane/lead`, `vethane/sekansta`, `vethane/cevap-geldi`, `vethane/demo-istedi`, `vethane/cikti`).

#### 3.3.2 Auto-graduation (kademeli otomatikleşme)
**User Story:** Kurucu olarak, bir aksiyon tipine güvendikten sonra onu otomatiğe almak istiyorum.

**Acceptance Criteria:**
- [ ] Her aksiyon tipi (`solo_fiyat_cevabi`, `takip_maili`, `mid_cold`, ...) için config'te `mode: manual|auto` anahtarı.
- [ ] `auto` iken sistem taslağı oluşturup **doğrudan gönderir** (guardrail'lerden geçmek şartıyla).
- [ ] Varsayılan: tümü `manual` (v1 lansman).
- [ ] `[TBD]` öneri: ~10 düzeltmesiz onay sonrası kurucuya "bunu auto yapalım mı?" önerisi (Faz 3).

### 3.4 Inbound Cevap Yönetimi

#### 3.4.1 Cevap algılama
**Acceptance Criteria:**
- [ ] Gmail Pub/Sub push, yeni mesajda webhook'u tetikler; `history.list` ile mesaj çekilir.
- [ ] Watch aboneliği 7 günde bir cron ile yenilenir.
- [ ] İlgili thread bir lead'e eşlenir (thread_id veya gönderen e-posta ile).

#### 3.4.2 Sınıflama & yönlendirme
**Acceptance Criteria:**
- [ ] AI (Claude Haiku) cevabı şu sınıflardan birine atar: `fiyat | demo | ilgili | ilgisiz | oto_yanit | cikis`.
- [ ] Segment + sınıf, playbook aksiyonunu belirler:
  - `solo` + `fiyat` → config'ten fiyat + trial linki taslağı.
  - `mid`/`hospital` (her sınıf) → keşif/demo pivotu taslağı, **fiyat yok**.
  - `*` + `demo` → **Telegram hot signal** + randevu taslağı + `durum=demo_istedi`.
  - `*` + `cikis` → suppression + sekans durdur + (opsiyonel) kısa onay taslağı.
  - `*` + `ilgisiz` → sekans durdur, `durum=kaybedildi`, taslak yok.
  - `*` + `oto_yanit` (OOO) → sekansı X gün ertele, taslak yok.
- [ ] Düşük güvenli sınıflama → kurucuya Telegram'dan sor, taslak üretme.

**Edge Cases:** Aynı thread'de birden çok yeni mesaj → en son müşteri mesajı sınıflanır. Cevap hem fiyat hem demo içeriyorsa → `demo` önceliklidir.

### 3.5 Bildirim

#### 3.5.1 Telegram hot signal
**User Story:** Kurucu olarak, biri demo isteyince anında haber almak istiyorum.

**Acceptance Criteria:**
- [ ] `demo` sınıfında: Telegram'a mesaj — klinik adı, şehir, segment, müşterinin sözü (alıntı), Gmail thread linki.
- [ ] Düşük güvenli sınıflama + (opsiyonel) günlük özet de Telegram'dan.
- [ ] Hangi olayların bildirim tetiklediği config'te ayarlanır.
- [ ] (Faz 3) Inline butonlar: "Görüldü", "Demo öner".

### 3.6 Uyumluluk & Guardrail

#### 3.6.1 Opt-out
- [ ] Her cold outbound, tek-satır çıkış yolu içerir ("çıkmak için yanıtlayın" veya link).
- [ ] `cikis` sınıfı → adres anında suppression'a eklenir, aktif sekans durur.

#### 3.6.2 Suppression kontrolü
- [ ] **Her gönderimden önce** alıcı suppression'a karşı kontrol edilir; varsa gönderim iptal + loglanır.

#### 3.6.3 Gönderen kimliği
- [ ] Her cold mail net gönderen kimliği içerir (kişi/şirket adı, Vethane, iletişim).

#### 3.6.4 Fiyat/söz guardrail (kritik)
- [ ] `segment ∈ {mid, hospital}` taslağında para-benzeri sayı (₺, "TL", para regex) tespit edilirse taslak **reddedilir/yeniden üretilir**.
- [ ] İndirim/taahhüt/garanti ifadeleri (onaylı kalıplar dışında) tespit edilirse reddedilir.
- [ ] `solo` fiyatı yalnız config lookup'tan literal enjekte edilir; AI sayıyı değiştiremez.
- [ ] Guardrail ihlali olay olarak loglanır (gözlemlenebilirlik).

### 3.7 Bilgi & Fiyat Kaynağı
- [ ] `pricing`, `modules`, `playbooks` config dosyaları **tek gerçek kaynak**, repo'da versiyonlu.
- [ ] Vethane konumlandırma/FAQ içeriği RAG için indekslenir; AI ürün sorularını buradan yanıtlar.
- [ ] Config değişince yeniden deploy yeterli; kod değişmez.

---

## 4. Architecture Overview

### 4.1 System Components
- **Outbound motoru:** Due-send'leri seçer, taslak ürettirir, guardrail'den geçirir, Gmail taslağı/gönderimi yapar, sekansı ilerletir. (Vercel Cron tetikli.)
- **Inbound motoru:** Pub/Sub webhook → mesaj çek → sınıfla → segment route → playbook taslağı → bildirim. 
- **AI katmanı:** Taslak üretimi (Sonnet) + sınıflama (Haiku), AI SDK + AI Gateway üzerinden; config/RAG enjekte eder.
- **Guardrail katmanı:** Tüm giden içeriği doğrulayan saf-fonksiyon doğrulayıcılar.
- **Lead/durum deposu:** Neon Postgres (leads, sequence_state, messages, suppression, events).
- **Lead sourcing/enrichment pipeline:** Google Places + resmi sicil ile aday kurum üretir, website kazıma ile e-posta zenginleştirir, kurucu onayına sunar (çekirdek ajandan ayrı; bir-kerelik/periyodik).
- **Config/RAG deposu:** Repo'daki versiyonlu config + RAG indeksi.
- **Entegrasyon adaptörleri:** Gmail (gönder/oku/taslak/etiket/watch), Telegram (bildirim).
- **Watch-renew job:** Gmail Pub/Sub aboneliğini yeniler (Vercel Cron).

### 4.2 Component Interactions
- **Outbound (async, zamanlı):** Cron → Outbound motoru → AI → Guardrail → Gmail API → Postgres.
- **Inbound (async, olay-tetikli):** Gmail → Pub/Sub → Webhook → Inbound motoru → AI → Guardrail (yanıt taslağı) → Gmail API + Telegram → Postgres.
- **Onay (insan, senkron-dışı):** Kurucu Gmail'de gönderir → sistem sonraki push/polling'te algılar → Postgres güncellenir.
- Config/RAG salt-okunur olarak AI çağrılarına enjekte edilir.

### 4.3 External Integrations
| Servis | Ne için | Fallback |
|---|---|---|
| **Gmail API (Workspace, OAuth Internal)** | Oku/gönder/taslak/etiket/watch | Token yenilenemezse: kurucuya Telegram uyarısı, işlem durur. |
| **Google Cloud Pub/Sub** | Inbound push | Push gelmezse: yedek polling cron (her N dk). |
| **Vercel AI Gateway → Claude** | Taslak + sınıflama | Gateway hatası: retry + kurucuya uyarı; sınıflama düşerse kuyrukta bekletilir. |
| **Telegram Bot API** | Hot signal bildirimi | Telegram hatası: e-posta-kendine yedek bildirim. |
| **Neon Postgres** | Durum deposu | Bağlantı hatası: retry; kritik. |
| **Google Places API** | Lead sourcing (aday kurum keşfi) | Yoksa: yalnız sicil + seed CSV ile küratörlük. |

---

## 5. Data Model

### 5.1 Core Entities

#### leads
| Field | Type | Required | Description | Constraints |
|---|---|---|---|---|
| id | UUID | Yes | Benzersiz kimlik | Auto |
| kurum_adi | text | Yes | Klinik adı | |
| sehir | text | No | Şehir | |
| tur | enum | No | muayenehane\|poliklinik\|hastane | |
| vet_sayisi | int | No | Veteriner sayısı | ≥0 |
| segment | enum | Yes | solo\|mid\|hospital\|unknown | Türetilir |
| tier | int | Yes | 1=premium(250) \| 2=3-5vet(~770) \| 3=solo | Outbound dalga önceliği |
| email | citext | Yes | İletişim e-postası | Unique, valid |
| website | text | No | Web sitesi | |
| place_id | text | No | Google Places kimliği | Dedup |
| phone | text | No | Telefon (fallback iletişim) | |
| instagram | text | No | Instagram (fallback) | |
| email_confidence | enum | No | high\|low | Enrichment güveni |
| karar_verici | text | No | Karar-verici adı | |
| kaynak | text | No | Lead kaynağı | |
| durum | enum | Yes | aday\|yeni\|sekansta\|cevap_geldi\|demo_istedi\|kazanildi\|kaybedildi\|cikti | |
| gmail_thread_id | text | No | İlişkili thread | |
| created_at / updated_at | timestamptz | Yes | | Auto |

#### sequence_state
| Field | Type | Required | Description |
|---|---|---|---|
| lead_id | UUID (FK→leads) | Yes | |
| current_step | int | Yes | 0..3 |
| next_action_at | timestamptz | No | Sıradaki dokunuş zamanı |
| last_sent_at | timestamptz | No | |
| status | enum | Yes | active\|paused\|stopped_replied\|stopped_optout\|completed |

#### messages
| Field | Type | Required | Description |
|---|---|---|---|
| id | UUID | Yes | |
| lead_id | UUID (FK) | Yes | |
| direction | enum | Yes | out\|in |
| gmail_message_id | text | No | |
| subject | text | No | |
| body | text | No | |
| classification | enum | No | fiyat\|demo\|ilgili\|ilgisiz\|oto_yanit\|cikis (inbound) |
| status | enum | No | draft\|approved\|sent\|rejected (outbound) |
| created_at | timestamptz | Yes | |

#### suppression
| Field | Type | Required | Description |
|---|---|---|---|
| email | citext | Yes | PK |
| reason | enum | Yes | optout\|bounce\|manual |
| created_at | timestamptz | Yes | |

#### events (audit / gözlemlenebilirlik)
| Field | Type | Required | Description |
|---|---|---|---|
| id | UUID | Yes | |
| lead_id | UUID (FK) | No | |
| type | text | Yes | sent\|reply\|classified\|guardrail_block\|notify\|optout\|error... |
| payload_json | jsonb | No | Olay detayı |
| created_at | timestamptz | Yes | |

### 5.2 Relationships
- Lead → has one → sequence_state (1:1)
- Lead → has many → messages (1:N)
- Lead → has many → events (1:N)
- suppression e-posta ile leads.email'e eşlenir (gevşek; gönderim öncesi kontrol)

### 5.3 Data Lifecycle
- Lead `yeni` → import. Sekans başlayınca `sekansta`. Cevap → `cevap_geldi`. Demo → `demo_istedi`. Kapanış → `kazanildi`/`kaybedildi`. Çıkış → `cikti` + suppression.
- **Soft-delete yok**; KVKK silme talebinde lead + messages hard-delete, e-posta suppression'da `manual` kalır (tekrar mail atmamak için).
- events kalıcı (audit). messages.body retention: `[TBD]` (öneri: süresiz, düşük hacim).

---

## 6. API Surface

### 6.1 API Style
İç servis; **public API yok (v1)**. Yalnız platform-tetikli HTTP uç noktaları (cron + webhook).

### 6.2 Endpoint Overview
| Method | Path | Description | Auth |
|---|---|---|---|
| POST | /api/cron/outbound | Due-send'leri işle (sekans ilerlet) | Cron secret |
| POST | /api/cron/watch-renew | Gmail watch yenile | Cron secret |
| POST | /api/cron/poll-sent | (Yedek) gönderilen taslakları/cevapları yokla | Cron secret |
| POST | /api/webhooks/gmail | Pub/Sub push (inbound) | Pub/Sub OIDC doğrulama |
| POST | /api/webhooks/telegram | (Faz 3) buton callback | Telegram secret token |

### 6.3 Authentication & Authorization
- Cron uç noktaları: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron header) doğrulanır.
- Pub/Sub webhook: Google OIDC token doğrulaması + beklenen audience.
- Telegram webhook: `X-Telegram-Bot-Api-Secret-Token` doğrulaması.

### 6.4 Rate Limiting
Public yüzey olmadığı için kullanıcı rate-limit yok. **Çıkış tarafı**: warmup limiti (3.2.3) + Gmail API kotası gözetilir.

### 6.5 Error Format
İç loglar yapısal; webhook'lar Pub/Sub'a hızlı `2xx` döner (retry fırtınası önlemek için), iş kuyruğa/event'e yazılır.

---

## 7. User Interface

### 7.1 Interface Type
**v1: özel web UI yok.** Kullanıcı yüzeyi = **Gmail** (taslak onayı + etiket pipeline) + **Telegram** (bildirim). Web paneli Future (12).

### 7.2 Key "Screens" (yüzeyler)
- **Gmail Taslaklar:** onay kuyruğu — kurucu taslağı düzenler/gönderir/siler.
- **Gmail Etiketleri:** pipeline görünümü (`vethane/*`).
- **Telegram sohbeti:** hot signal akışı + (Faz 3) aksiyon butonları.

### 7.3 Responsive / Erişilebilirlik
Gmail + Telegram kendi istemcilerini kullanır (mobil+masaüstü hazır). Özel UI olmadığı için ek gereksinim yok (v1).

---

## 8. Security Model

### 8.1 Authentication (sistem→servisler)
Gmail OAuth2 (Internal app, refresh token). Token'lar şifreli saklanır (Vercel env + gerekiyorsa DB'de şifreli). En-az-yetki scope'ları (gmail.modify + gerekli minimum).

### 8.2 Authorization
Tek kullanıcı (kurucu); rol modeli yok (v1). Webhook/cron uç noktaları secret ile korunur (6.3).

### 8.3 Data Protection
- Lead e-postaları = kişisel/işletme verisi (KVKK). İş adresleri hedeflenir; suppression + silme talebi desteklenir.
- Lead sourcing: Google Places ToS gözetilir; website'ten yalnız işletmenin **kamuya açık yayınladığı** iletişim e-postası alınır (B2B tacir/esnaf, opt-out ile).
- Transit TLS (Vercel/Neon varsayılan). Secrets repo'ya girmez (env).
- AI çağrılarında zero-data-retention tercih edilir (AI Gateway).

### 8.4 Input Validation
Webhook payload'ları şema-doğrulanır; CSV import sanitize edilir; AI çıktısı guardrail'den geçmeden gönderilmez.

---

## 9. Deployment Model

### 9.1 Target Environments
Production: Vercel (Fluid Compute). Development: local (`vercel dev`) + ayrı Neon branch/DB.

### 9.2 Distribution Method
SaaS değil; kurucunun kendi Vercel projesi. Erişim yalnız kurucuda.

### 9.3 Configuration
- Secrets/env: Vercel env (GMAIL_*, AI_GATEWAY_KEY, TELEGRAM_*, CRON_SECRET, DATABASE_URL, PUBSUB_*).
- İş kuralları: repo'daki `config/` (pricing, modules, playbooks, warmup, notify, action-modes).
- Cron tanımları: Vercel proje konfigürasyonu (vercel.ts/vercel.json).

### 9.4 System Requirements
Vercel + Neon + Google Cloud projesi + Workspace + Telegram. Çalışma maliyeti bu hacimde ~$7-27/ay.

---

## 10. Performance Requirements

### 10.1 Response Time
- Inbound cevap işleme: push'tan **≤ ~1 dk** içinde taslak + bildirim.
- Webhook → Pub/Sub'a `2xx`: < birkaç sn (ağır iş arka planda).

### 10.2 Throughput
Düşük: başlangıç ~5-10 ilk-dokunuş/gün + birkaç inbound/gün. Tasarım ~50/gün'e kadar değişiksiz ölçeklenir.

### 10.3 Resource Limits
Neon free tier yeterli (binlerce lead/mesaj). AI maliyeti ayda birkaç $.

---

## 11. Constraints & Non-Goals

### 11.1 Technical Constraints
- info@vethane.com **Google Workspace'e taşınmış olmalı** (iCloud'da API yok).
- Gmail Pub/Sub için public HTTPS webhook (Vercel sağlar).
- OAuth uygulaması Workspace-Internal (Google doğrulaması gerektirmez).

### 11.2 Non-Goals (kapsam dışı — v1)
- **Web UI / dashboard:** Gmail+Telegram yeterli; UI Future.
- **Tam otonom gönderim (lansmanda):** insan-onay zorunlu; otonomi kademeli.
- **Yüksek-hacim mass cold email / spray-and-pray:** isabet oyunu, hacim değil.
- **Mid/hastaneye otomatik fiyat verme:** değer-satışını korumak için yasak.
- **Demo otomatik takvim randevusu:** v1 bildirim + manuel; Calendar Future.
- **Çok-kanal (WhatsApp/SMS/LinkedIn):** v1 yalnız e-posta.
- **Tam CRM / gelişmiş analitik:** sadece temel durum + event log.
- **Sürekli/ölçekli otomatik scraper:** Bir-kerelik yarı-otomatik küratörlük (Places + sicil + website kazıma, kurucu onaylı) kapsamda (§3.1.3-3.1.5); sürekli geniş-ölçek scraping kapsam dışı.
- **Çok-kullanıcılı/ekip hesapları:** tek kurucu.
- **TR dışı dil:** v1 yalnız Türkçe.

### 11.3 Assumptions
- info@vethane.com lansmandan önce Workspace'e taşınır.
- Kurucu taslakları düzenli (günlük) onaylar.
- Veteriner klinikleri tacir/esnaf → B2B muafiyeti geçerli.
- Lead e-postaları çoğunlukla iş adresleridir.
- Hacim düşük kaldığı için birincil domain'den gönderim makul (warmup ile).

### 11.4 Open Questions
- **[TBD: Warmup ramp]** Kesin günlük artış. Öneri: 5-10/gün başla, haftada +5, ~30/gün tavan.
- **[TBD: Auto-graduation eşiği]** Kaç düzeltmesiz onay? Öneri: ~10 (solo fiyat + takip ile başla).
- **[TBD: messages.body retention]** Öneri: süresiz (düşük hacim) veya 18 ay.
- **[TBD: Yedek polling]** Push güvenilirse poll-sent gerekir mi? Öneri: ilk 2 hafta güvenlik için aç, sonra kapat.

---

## 12. Future Considerations
- **v1.1:** İnce web paneli (pipeline + kural editörü + analitik).
- **v1.2:** Auto-graduation önerileri + günlük Telegram özeti + buton aksiyonları.
- **v1.3:** Google Calendar entegrasyonu — demo için otomatik slot önerisi.
- **v2.0:** Ölçekli lead scraper/enrichment pipeline; WhatsApp kanalı; A/B test edilen sekanslar; Vethane Faz-2 benchmarking verisini satış argümanına bağlama.
