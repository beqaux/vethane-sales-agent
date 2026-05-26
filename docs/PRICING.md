# Vethane — Somut ₺ Fiyatlandırma Analizi (v3.2 — değer-bazlı, büyüklük-kademeli)

> **Durum:** Karara bağlandı (grill-with-docs, 2026-05-24). Sayılar tunable; **model** sabit (bkz. [`ADR-0004`](../adr/0004-deger-bazli-buyukluk-kademeli-fiyat.md)).
> **Sürüm:** v3.2 (2026-05-25) — solo (1-2) +%31 korundu; **mid/hastane cerrahi kısıldı** → capture %26-54 → **%23-47** (mid %54→%46), eğri yine dik (değer-tiering korundu). v3.1 (2026-05-24) tüm bantları ×1,31 yapmıştı. **Model sabit** (ADR-0004); v3 temeli: fiyat rakip lisansına değil **arka-ofis maliyetine** demirli, büyüklüğe kademeli (v1/v2 SUPERSEDED).
> v3.3 (2026-05-26) — §10 satış akışı 2-adımlı (demo → ayrı teklif görüşmesi) olarak güncellendi
> ([ADR-0005](../adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md)). Fiyat seviyeleri değişmedi.
> **Kapsam:** Fiyat seviyeleri. Paketleme & gelir modeli kilitli: [`CONTEXT.md`](../../CONTEXT.md), [`ADR-0001`](../adr/0001-modul-paketleme-ve-gelir-modeli.md). Konumlandırma: [`ADR-0003`](../adr/0003-konumlandirma-veteriner-isletme-yonetimi.md). Fiyat modeli: [`ADR-0004`](../adr/0004-deger-bazli-buyukluk-kademeli-fiyat.md).
> **Para birimi:** ₺, **KDV hariç** (B2B; faturada %20 eklenir, klinik indirir).
> **İş hedefi:** Geliri **2 kurucu** paylaşır → viability 2 maaşa göre (§3).

---

## 0. TL;DR

**Konum:** Vethane = **Veteriner İşletme Yönetimi** (muhasebe/gün-sonu, İK/vardiya/bordro, kafe/POS, analitik) — klinik/pratik PMS değil. Bu derinlikte **vet-özel rakip yok** (boş alan). Fiyat, rakibin lisansına değil **kliniğin bugün arka-ofise harcadığına** demirlenir.

**Fiyat matrisi (₺/ay, KDV hariç) — klinik vet-sayısı bandına göre:**

| Birim | 1-2 vet | 3-5 vet | 6+ vet |
|---|---:|---:|---:|
| **Danışma** (taban, zorunlu) | **1.950** | **3.200** | **5.400** |
| **Muhasebe** (anchor) | 1.950 | 3.300 | 7.000 |
| **İK** (anchor) | 1.550 | 2.800 | 5.800 |
| **Yönetim Analitiği** (anchor) | 1.050 | 2.000 | 4.100 |
| **Kafe** | 650 | 900 | 1.400 |
| **Doktor** (kişi-başı/ay) | 260 | 220 | 195 |
| **İletişim** | 0 | 0 | 0 (Verimor BYO + referral) |

Çarpanlar: expansion indirimi %5/%10/%15 (2/3/4 modül) · yıllık ~%17 · trial 14-30 gün.

**Senaryolar (₺/ay):** solo muayenehane (taban+1vet+Muhasebe) **₺4.160** · mid poliklinik (4vet+3anchor) **≈₺11.370** · hastane (6vet+4anchor+kafe) **≈₺22.125**.

**Ne kazanırsın (kurucu başına/ay, dağıtılabilir, 50/50):** hedefli **~50 klinikte ₺144k**, broad **~100 klinikte ₺196k**. **2 konforlu kurucu maaşı (₺120k×2): ~42 (hedefli) / ~61 (broad) klinik.** Nakit break-even ~1 klinik.

---

## 1. Çerçeve: üç sınır + değer-bazlı ilke

1. **Konumlandırma (ADR-0003):** Vethane bir **veteriner işletme yönetimi** platformu — derinliği muhasebe/İK/analitikte; klinik/pratik derinliği (lab/PACS/derin SOAP) kasıtlı kapsam dışı. 2026-05 rakip analizi: bu derinlikte **TR'de vet-özel rakip yok** (İK/bordro/vardiya = tam boş alan). E-vet zıt uçta (klinik/tıbbi) → tamamlayıcı, rakip değil.
2. **Değer-bazlı fiyat (ADR-0004):** Kategori yaratıyoruz → rakip lisansı zayıf çıpa. Fiyat, kliniğin **bugün arka-ofise katlandığı maliyete** (muhasebeci + bordro + sahip-zamanı + parçalı yazılım) demirlenir; bunun **%20-30'u** yakalanır (mission-critical vertical SaaS normu). Değer klinik büyüklüğüyle 4-7x ölçeklendiği için fiyat **vet-sayısı bandına göre kademeli**.
3. **Strateji (ADR-0001):** Taban + Doktor giriş; **Muhasebe + İK + Analitik = marj (anchor)**; İletişim bedava. Land-and-expand korunur; ama taban artık "ucuz PMS" değil, **işletme-yönetimi platformuna giriş**.

> **Pazar yapısı:** TR'de **9.637 ruhsatlı kurum** (9.387 muayenehane + 134 poliklinik + 116 hastane, Ekim 2025). Yasa: muayenehane ≤3 vet, poliklinik ≥4. Dağılım ~%90 (1-2 vet) / ~%8 (3-5) / ~%2 (6+). Hacim 1-2 vet'te ama **değer/ödeme-gücü/moat 3-5 ve 6+'da** → satış eforu oraya (§6.1).

---

## 2. Fiyat Matrisi — Satır Satır Gerekçe

**Nasıl okunur:** Kliniğin **vet sayısı** bandını belirler (1-2 / 3-5 / 6+). O bandın sütunundaki taban + seçilen modüller toplanır; **Doktor** = vet sayısı × o bandın kişi-başı oranı; expansion indirimi (modüllere) uygulanır; yıllık opsiyon. Tek boyut: **vet sayısı = büyüklük = değer proxy'si.**

### 2.1 Danışma (taban) · 1.950 / 3.200 / 5.400
Randevu, müşteri & hasta, randevudan türeyen klinik notlar, doktor listesi, danışma raporları, **İletişim (Verimor SMS, bedava)**, Admin→Kullanıcılar.
- **Çıpa:** Ön-büro değeri klinik büyüklüğüyle artar (daha çok randevu/kullanıcı/personel). Klinik/pratik PMS rakipleri ₺499-2.166 (klinik-başı) — ama Vethane tabanı işletme-yönetimi platformuna **giriş**, salt PMS değil; bedava SMS farklılaştırıcı.
- Taban artık **land-lideri-ucuz değil**: konum "ciddi klinik için işletme platformu". Freemium (DoldurKabı ₺0) farklı alıcı; derinlikle ayrışırız.

### 2.2 Doktor · kişi-başı 260 / 220 / 195
`Veterinarian` rolüne **Bugünüm + Performansım**. Vet-sayısı bandının oranı tüm koltuklara uygulanır (whole-count, monoton). Yasayla doğrulandı: muayenehane ≤3, poliklinik ≥4; **6+ nadir** (en büyük hastaneler 8-10), 6+ oranı sembolik. Per-doctor model komşu dikeylerde standart (Kolayvet, DentSoft, DentalBulut +₺320/hekim).

### 2.3 Muhasebe (anchor) · 1.950 / 3.300 / 7.000
Vet servisleri + fiyatlama, işlemler, giderler, **Gün Sonu**, aylık hedefler, kasa/banka transfer, **banka bakiye mutabakatı**, raporlar.
- **Değer çıpası = muhasebeci ücreti + sahip-zamanı**, Paraşüt'ün ₺752'si DEĞİL. TÜRMOB 2026: serbest meslek defteri ₺4.5-6k taban (gerçek 5-10k); Limited ₺8-25k. Faz-1 değeri "iç finansal kontrol + zaman" (solo ~4-6k, mid ~7-10k, hastane ~12-18k) → %20-30 capture.
- **vet-özel rakip yok** (CetaSoft en yakın; gün-sonu/mutabakat kimsede yok).
- Faz-1 muhasebeciyi **ikame etmez** (e-fatura yok), tamamlar → Faz-2 e-fatura ile ikame → fiyat ↑ (§7).

### 2.4 İK (anchor) · 1.550 / 2.800 / 5.800
Personel, **vardiya otomatik planlama** (UnifiedShiftPlanner), izin, bordro/puantaj.
- **En derin moat:** rakiplerin **hiçbirinde** İK/bordro/vardiya yok (bağımsız doğrulandı); inşası zor (SGK/puantaj/mevzuat).
- **Değer çıpası = bordro hizmeti + vardiya/puantaj zamanı** (mid ~7.5k, hastane ~13-17k). Solo'da İK düşük talep (az personel) → solo fiyatı düşük; asıl değer **3-5 ve 6+'da**.

### 2.5 Yönetim Analitiği (anchor) · 1.050 / 2.000 / 4.100 (Faz-1)
Konsolide Rapor + Karşılaştırma. **Doğrudan rakip yok.** Faz-1 = konsolidasyon/raporlama zamanı tasarrufu. **Faz-2 benchmarking** (data-as-feature) → konsolidasyonun 2-3x'i, fiyat esnekliği en yüksek katman (§7.1).

### 2.6 Kafe · 650 / 900 / 1.400
POS + stok (kafe/perakende tezgâhı). Niş; veteriner bağlamında ayrı kafe-POS sunan rakip yok. Düşük güven, veriyle revize.

### 2.7 İletişim · 0 + Verimor referral
SMS via Verimor (BYO); maliyet + İYS/başlık kliniğin (ADR-0002). Bonus: referral/reseller komisyonu.

### 2.8 Çarpanlar
- **Expansion indirimi** (yalnız modüllere; taban + Doktor hariç): 2 modül %5 · 3 modül %10 · 4 modül %15.
- **Yıllık:** ~%17 ("2 ay bedava"); land hızı gerekirse %25-30 (pazar normu %50-60).
- **Trial:** 14 gün (anchor'lar 30 gün — altyapı maliyeti ≈ 0).

---

## 3. Maliyet, Ölçekleme & Kazanç

### 3.1 Kademeli altyapı (klinik sayısıyla adım-fonksiyonu)
| Klinik | Mimari | Aylık burn | Altyapı/gelir |
|---:|---|---:|---:|
| ~25 | VPS-2 tek kutu + Vercel Pro | ~₺1.470 | <%2 |
| ~100 | VPS-3 (Postgres RAM) | ~₺2.290 | <%1 |
| ~250 | Rise dedicated + 2. Vercel koltuğu | ~₺6.500 | <%1 |
| ~500 | DB ayrımı | ~₺12.030 | <%1 |
| ~1000 | 2× app node HA + 64GB replica | ~₺18.290 | <%1,5 |

Klinik 40× → maliyet 12,4× (lineer değil). Marjinal klinik ≈ ₺0. **Asıl maliyet altyapı değil, kurucu/destek zamanı.** Vercel→VPS taşıma ancak ~1000 klinikte.

### 3.2 ARPA (klinik başı ort. gelir)
Dağılım + modül adopsiyonuna göre: **broad ~₺3.950** (%90 solo karışık) / **hedefli ~₺5.800** (mid+hastane ağırlıklı satış; v3.2 trim sonrası). Planlama: hedefli (§6.1).

### 3.3 💰 Kazanç — kurucu başına aylık eline geçen
*(MRR KDV hariç; dağıtılabilir = MRR − altyapı; 50/50 bölüşüm. **Vergi, ödeme komisyonu ~%2, pazarlama HARİÇ** — kabaca brüt kurucu geliri.)*

**Broad (ARPA ₺3.950):**
| Klinik | MRR | Kurucu/ay | Kurucu/yıl |
|---:|---:|---:|---:|
| 25 | 98.750 | **₺48.600** | 583k |
| 50 | 197.500 | **₺98.000** | 1,18M |
| 75 | 296.250 | **₺147.400** | 1,77M |
| 100 | 395.000 | **₺196.400** | 2,36M |
| 150 | 592.500 | **₺295.100** | 3,54M |

**Hedefli (ARPA ₺5.800):**
| Klinik | MRR | Kurucu/ay | Kurucu/yıl |
|---:|---:|---:|---:|
| 25 | 145.000 | **₺71.800** | 862k |
| **50** | 290.000 | **₺144.300** | 1,73M |
| 75 | 435.000 | **₺216.800** | 2,60M |
| 100 | 580.000 | **₺288.900** | 3,47M |

### 3.4 Viability (2 kurucu)
| Kurucu çekişi (×2) | Broad | Hedefli |
|---|---:|---:|
| Piyasa (₺85k×2) | ~44 klinik | ~30 klinik |
| **Konforlu (₺120k×2)** | **~61** | **~42** |
| Dev-seviye (₺150k×2) | ~77 | ~52 |

**Nakit break-even (sadece altyapı): ~1 klinik.** → **Hedefli ~42 klinikte 2 konforlu maaş** (₺120k); ~50 klinikte her kurucu **~₺144k/ay** (mid-dev ₺80k'nın üstünde), düşük destek yüküyle.

---

## 4. Üst Sınır — Değer Tavanı & Rekabet

### 4.1 Değer tavanı = kliniğin bugünkü arka-ofis maliyeti
| Segment | Bugünkü arka-ofis/ay (muhasebeci+bordro+sahip-zamanı+parçalı yazılım) | Vethane tam-stack | Capture |
|---|---|---:|---:|
| Solo (1-2 vet) | ₺13.500-19.500 | ~₺6.305 | ~%32-47 |
| Mid (3-5 vet) | ₺24.500-34.500 | ~₺11.370 | ~%33-46 |
| Hastane (6+) | ₺54.000-96.000 | ~₺22.125 | ~%23-41 |

Vethane faturası kliniğin **zaten harcadığının dilimi** — v3.1'de value-capture %26-54'e çıkıp **v3.2'de mid/hastane cerrahi kısılarak %23-47'ye** çekildi (solo +%31 korundu; rakip-tavanı yok, tavanı ödeme gücü çiziyor). Capture değer-koridorunun makul üstünde, %50 altında → **hacimle yukarı test edilebilir.**

### 4.2 Rekabet (reframe)
- **Klinik/pratik PMS** (Kolayvet 499-2.166, BulutVet, DoldurKabı ₺0) → sadece **tabanla** örtüşür; anchor derinliğinde değil. **E-vet** zıt uçta (PACS/lab) → tamamlayıcı.
- **Bağımsız işletme yazılımı** (Paraşüt ₺752, Kolay İK) → vet-entegre değil; "parçalı yığın"ın parçası.
- **Hiçbir rakip** derin vet-entegre işletme yönetimi sunmuyor → anchor'larda **vet-özel rakip tavanı yok**, tavanı ödeme gücü çiziyor.
- **İzleme:** HivePetVet ("yönetim platformu" + konsolidasyon, beyaz alana en yakın), veteranClinic (en geniş işletme özellikli). Tehdit düşük-orta; İK/bordro/vardiya derin hendek.

### 4.3 Ödeme gücü kontrolü
TVHB 2026 tarife (muayene ₺1.750, kısırlaştırma ₺5-9.5k), vet asgari net ₺85k, solo ciro ₺150-300k, mid ₺300-600k. SaaS normu cironun %6-12'si (tüm yazılım). Vethane tam-stack: solo ~₺6,3k (ciro ~%2-4), mid ~₺11,4k (~%2-4), hastane ~₺22,1k (~%2-3). Hepsi ödeme gücü içinde.

---

## 5. Örnek Senaryolar (₺/ay, KDV hariç)

| Senaryo | Hesap | Toplam |
|---|---|---:|
| **Solo muayenehane** | taban 1.950 + 1×260 + Muhasebe 1.950 | **4.160** |
| Solo full | 1.950 + 260 + (1.950+1.550+1.050 −%10) | **6.305** |
| **Mid poliklinik (4 vet)** | 3.200 + 4×220 + (3.300+2.800+2.000 −%10) | **11.370** |
| **Hastane (6 vet) full+kafe** | 5.400 + 6×195 + (7.000+5.800+4.100+1.400 −%15) | **22.125** |

---

## 6. Öneriler

**6.1 GTM:** **Hedefli** — solo'yu self-servis tabanla funnel'da tut, **satış eforunu 3-5 vet + hastaneye** ver (ödeme gücü + acı + moat orada zirve; solo'da İK talebi düşük). 50 büyük klinik (₺250k MRR) > 145 küçük (düşük destek + hızlı viability).
**6.2 Yıllık:** ~%17; land hızı gerekirse %25-30.
**6.3 KDV:** Hariç (B2B; klinik indirir). UI'da "+KDV" net.
**6.4 FX/enflasyon:** ₺ koy, dönem içi sabit, yıllık revizyon TÜFE (~%32) + FX takipli; FX-endeksleme yapma (marj absorbe eder; altyapı gelirin <%2'si). ⚠️ Giderler €/$ → kur en büyük gizli değişken.

---

## 7. Gelecek Planları
1. **Faz-2 — Benchmarking:** ~30-50+ klinikte anonim klinikler-arası benchmarking → Analitik 2-3x (₺5k+/hastane gerçekçi). Ağ-etkili moat. ~12-18 ay.
2. **Muhasebe + e-fatura:** muhasebeciyi kısmen **ikame** → Muhasebe değer tavanı ↑ → fiyat hastanede ₺7k→9k+, mid ₺3,3k→5k+. Modül-başı tavan burada tam gerçekleşir.
3. **Verimor referral geliri** (pasif, klinik sayısıyla ölçeklenir).
4. **KOSGEB hibe kancası** (%80'e kadar dijitalleşme desteği) — satış aracı.
5. **Yıllık fiyat revizyonu** (ilk 2027-Q2; TÜFE+FX).
6. **Fiyat deneyleri:** capture %'sini (şu an %20-30 alt-orta bant) hacimle yukarı test et; mid anchor adopsiyonu izle.

---

## 8. Riskler & İzlenecekler

> İkincil kararlar best-practice ile **kapatıldı** (§10). Aşağıdakiler artık "açık karar" değil; **izlenecek / hacimle revize edilecek** kalemler.
1. **Capture %23-47 (v3.2)** — v3.1'de %26-54'e çıkıp v3.2'de mid/hastane trim'le çekildi (ADR-0004 "yukarı test"). TR vertical WTP ABD altı olabilir → hacimle doğrula.
2. **ARPA hedefli ₺5.000 varsayımı** mid/hastane satış mix'ine bağlı → gerçek satışla revize (viability'yi doğrudan etkiler).
3. **Solo taban ₺1.950** artık ucuz değil → solo adopsiyonu yavaşlayabilir; ama hedef zaten mid/hastane (kabul).
4. **Mid full-stack capture ~%33-46** (v3.2 trim sonrası) → izlemeye devam; dirençte indirim.
5. **Rekabet hendeği:** HivePetVet izle (beyaz alana en yakın).
6. **Kafe** düşük güven.

---

## 9. Veri Eki — Kaynaklar (✅ doğrulanmış / 🟡 tahmin)
- **Arka-ofis maliyeti:** ✅ TÜRMOB 2026 SMM tarifesi (serbest meslek defteri ₺4.492-5.989, Limited ₺3.606-7.985; RG 33110, 17.12.2025); ✅ muhasebe elemanı ~₺40k net / ~55-70k işveren maliyeti (eleman.net); 🟡 sahip-zamanı 15-40 sa/ay (uluslararası KOBİ proxy); 🟡 gerçek-ödenen muhasebe 5-25k (tek kaynak, tarifeyle tutarlı).
- **Değer-capture:** ✅ %20-30 mission-critical vertical SaaS normu; ✅ KOBİ yazılım payı ciro %6-12.
- **Rekabet/derinlik:** ✅ hiçbir TR vet ürününde İK/bordro/vardiya yok (vetesveteriner.com); ✅ E-vet PACS/lab (klinik-derinlik); ✅ Kolayvet 499/990/2.166, BulutVet ~460-1000, DoldurKabı ₺0.
- **Pazar/ödeme gücü:** ✅ 9.637 kurum (vettingforvets.org); ✅ muayenehane ≤3/poliklinik ≥4 vet (RG 28085); ✅ TVHB 2026 tarife; ✅ vet asgari net ₺85k (AVHO); ✅ TÜFE Nis-2026 %32,37; 🟡 klinik ciro 150-300k.
- **Altyapı:** ✅ OVH VPS/Rise, Vercel Pro $20, Neon/Supabase, B2; ✅ kur 1$=45,7₺ / 1€=53₺ (2026-05).

---

## 10. Operasyon & Satış Playbook (best-practice — karara bağlandı)

Kalan ikincil kararlar en iyi pratiğe göre sabitlendi (model sabit, sayılar tunable):

| Karar | Seçim | Neden |
|---|---|---|
| **Capture %** | mid-bant (mevcut matris) | Yeni ürün, kanıt yok → düşükten başla, yılda zamla ("zam kolay, indirim zor") |
| **GTM** | Hedefli: 3-5 vet + hastane öncelik; solo self-servis funnel | Para + acı + moat orada zirve; az müşteri = az destek + hızlı viability |
| **Yıllık indirim** | %17 (2 ay bedava) | Peşin nakit + düşük müşteri kaybı; bootstrap'a iyi |
| **Expansion indirimi** | 2/3/4 modül %5/%10/%15 | Çok-modül teşvik, anchor marjını korur |
| **Trial** | Taban 14g / anchor 30g + rehberli kurulum | Sürtünme düşür ama saf self-serve değil (veri taşıma/eğitim) |
| **FX/enflasyon** | ₺ fiyat, dönem-içi sabit, yıllık ~TÜFE güncelleme | Müşteri korkutma; marj şoku absorbe eder |
| **Fiyat gösterimi** | Solo tier sitede açık; mid/hastane "Teklif Al" | Funnel + güven (solo) + değer-satışı (büyük) |
| **Tahsilat** | Aylık kart (iyzico/PayTR) + yıllık peşin havale | TR'de standart recurring B2B SaaS tahsilatı |

**Satış akışı (mid/hastane), 2-adımlı:**

**Adım 1 — Demo (sistem gösterimi):** Klinik isteyince, AI ajan demo zamanı önerir ve kurucuya
Telegram bildirir. Demo = fake-data ürün-tour'u (modüller, ekranlar, akış). **Demoda harcama
sorusu ve teklif YOKTUR.** Demo bitiminde kurucu, klinikten "teklif görüşmesi" için ayrı bir
takvim slot'u talep eder.

**Adım 2 — Teklif görüşmesi (kurucu manuel):** *"Bugün muhasebeci + bordro + vardiya +
raporlamaya ne harcıyorsunuz?"* (≈ §4.1 arka-ofis maliyeti, ₺25-90k) → Vethane tek sistemde +
fraksiyonuna → klinik büyüklük bandına göre teklif.

Bu ayrım [ADR-0005](../adr/0005-demo-sistem-gosterimi-iki-adimli-satis.md) ile kararlaştırıldı.
Demo sürtünmesini düşürür (daha çok demo bookings); teklif görüşmesi nitelikli müşteriyle yapılır.

**İlk 3-5 müşteri:** indirimli/uzun-trial referans pilotu → memnuniyet referansı + Faz-2 benchmarking verisi + ürün geri bildirimi. Klinik #1'e tam liste fiyatı dayatma.

**Onboarding kritik:** veri taşıma + personel eğitimi iyi olmazsa müşteri kaçar. İlk ay elle tutarak kur.

**Milestone:** hedefli ~50 büyük klinik = her kurucu ~₺124k/ay (§3.3).
