# ADR-0005 — Demo, sistem gösterimi olarak yeniden tanımlandı (2-adımlı satış)

> **Durum:** Accepted (2026-05-26)
> **Bağlam:** Grilling oturumu çıktısı (`grill-with-docs`, 2026-05-26).
> **Karar veren:** Berkay Kıran (kurucu).
> **Ilgili:** [ADR-0003 — Konumlandırma](0003-konumlandirma-veteriner-isletme-yonetimi.md) (referans; dosya henüz oluşturulmadı), [ADR-0004 — Değer-bazlı fiyat](0004-deger-bazli-buyukluk-kademeli-fiyat.md) (referans; dosya henüz oluşturulmadı), [`docs/PRICING.md` §10](../PRICING.md#10-operasyon--sat%C4%B1%C5%9F-playbook), [`CONTEXT.md` karar #2](../../CONTEXT.md#1-%C3%A7%C3%B6z%C3%BClen-kararlar-karar-a%C4%9Fac%C4%B1).

> **Not:** Bu repodaki **ilk fiziksel ADR dosyası**. Diğer ADR'lar (`0001`, `0002`, `0003`, `0004`) `docs/PRICING.md`'den referanslanıyor ama henüz dosyalanmadı. Hijyen için sonra doldurulması gerekiyor (bu iterasyon dışı).

---

## 1. Bağlam

Vethane'in çift-modlu AI satış ajanı (`saas-seller`), mid/hastane segmentinde fiyat vermez; bunun yerine **demoya yönlendirir**. PRICING.md §10 ve `lib/config/playbooks.ts:35` mevcut hâliyle "demoda net teklif veririm" diyor. Bu, demoyu **fiyat keşfi + teklif** anına yerleştiriyordu.

Grilling sırasında (S1 + S2 senaryoları üzerinden) bu tanımın pratikte iki sürtünme yarattığı görüldü:

1. **Mid/hastane segmenti web inbound'da demo isterse:** AI ajan "Demoda harcamanızı sorup teklif veririm" demek zorunda. Bu, henüz tanışmamış ve sistemi görmemiş bir lead'i ilk demoda **finansal bilgi paylaşmaya** zorluyor. Çıtayı yükseltiyor → daha az demo bookings.
2. **Demo tek-kerede çok şey yapmaya çalışıyor:** sistem turu + acı keşfi + finansal sorgu + teklif. Bu kombinasyon ya kurucu rolünde olmayan AI ajanından çıkmaz, ya kurucunun yapması gerek; AI ajanın kapsamından çıkar.

Soru: Demo nedir — **ürün gösterimi** mi, yoksa **fiyat keşfi + teklif görüşmesi** mi?

## 2. Karar

**Demo = sistem gösterimi.** Fake-data ürün-tour'u. Harcama sorusu / teklif YOKTUR.

Satış 2 adıma ayrıldı:

| Adım | Ne | Kim | Kapsam |
|---|---|---|---|
| **1) Demo** | Sistem gösterimi (canlı tour, fake-data, modüller, akış) | AI ajan demo kurar, kurucu sunar | Modüller, ekranlar, "bu ne işime yarar" |
| **2) Teklif görüşmesi** | Harcama keşfi (≈§4.1 arka-ofis maliyeti, ₺25-90k) → değer karşılaştırma → büyüklük bandı teklifi | Kurucu (AI ajan kapsam dışı) | Bordro/muhasebe/vardiya bugün ne tutuyor, Vethane fraksiyonunda + büyüklüğe göre teklif |

Demo'dan sonra ikinci görüşme **kurucu tarafından** ayarlanır. AI ajan demo onayı + tarih önerisi verir, kurucu manuel takip eder.

## 3. Gerekçe

**Sürtünmeyi düşürür → daha çok demo:** "20 dk size sistemi göstereyim" demo daveti, "20 dk demoda harcamanızı sorup teklif veririm" davetinden çok daha düşük çıtalı. Tipik B2B SaaS demo flow'u zaten budur (Calendly + sistem gezme). Mid/hastane lead'i sistemi görmeden harcamasını paylaşma psikolojisinde değil — önce güven, sonra finansal açılım.

**Rol ayrımı netleşir:** AI ajan "sistem gösterimi onayla + zaman öner + kurucu bildirsin" yapar. Harcama keşfi + teklif **insan-insana**, çünkü:
- Esnek müzakere gerektirir (modül seçimi, sözleşme süresi, pilot indirimi).
- Klinik tarafından subtil sinyaller (kim karar veriyor, gerçekçi bütçe nerede) ancak kurucu tarafından okunabilir.
- AI ajan PRICING v3.2'nin mid bandını kafa-üstüne ezberleyemez; üretirse halüsinasyon riski.

**Demoya odak:** Demo'nun "iyi bir ürün turu" olarak optimize edilmesi, ileride şu işleri açar:
- Pre-recorded demo (asenkron seyret) → reach 10x.
- Demo sırasında dinamik müşteri-spesifik veri (Faz-2 benchmarking).
- Self-serve demo (interactive sandbox).

Bunların hiçbiri "demo = teklif görüşmesi" tanımıyla mümkün değil.

## 4. Sonuçlar

### Pozitif
- Demo bookings rate ↑ (daha düşük çıta).
- AI ajanın kapsam sınırı netleşti; halüsinasyon yüzeyi daraldı (artık demoda fiyat/teklif YOK).
- 2. görüşme = nitelikli (sistemi gördükten sonra fiyat konuşmak isteyen lead).

### Negatif
- 2 görüşme = kurucu için **2x kalibre zaman** (her demo başı). Mitigation: demo'yu kurucu yapsa bile teklif görüşmesini ayrı slot olarak takip et; bazı lead'ler demo sonrası kendi vazgeçer (bu daha iyi qualification).
- "Pipeline'da bir lead var, demoyu izledi ama teklif aşamasına gelmedi" yeni bir state. Mevcut `LEAD_DURUMLARI` enum'ı buna karşılık `demo_istedi` → `kazanildi/kaybedildi` doğrudan geçiyor. **Yeni state: `demo_izledi`** (durum: demo yapıldı, teklif görüşmesi bekleniyor). Bu küçük şema değişikliği bu iterasyonda yapılmaz; v3'te ele alınacak (TODO: gözlem).

### Nötr (operasyonel revizyonlar)
Bu karar şu artefaktları değiştirir; her biri `docs/playbook-v2/TASKS.md`'de izlenir:
- `docs/PRICING.md §10` "Satış akışı (mid/hastane)" → 2-adımlı tanımla yeniden yazıldı.
- `lib/config/playbooks.ts` mid.reply.guidance ve hospital.reply.guidance → "demoda net teklif" → "demoda sistemi gösterip, ayrı bir görüşmede teklif".
- `CONTEXT.md` karar #2 satırı → güncellendi (zaten yapıldı).

## 5. Alternatifler (değerlendirildi, reddedildi)

### Alt-1: Demo = sistem gösterimi + harcama sorusu, teklif demo sonu
**Reddedildi.** Bir görüşmede iki rol değiştirme (eğitici → satışçı) AI ajan için de kurucu için de hatalı kalibre. Kurucu daha çok satış stresi alır, demo akıcılığı kaybolur.

### Alt-2: Mevcut tanım (demo = keşif + teklif) korunsun, AI sadece bildirim atsın
**Reddedildi.** S1 + S2 senaryolarında bu tanım, mid/hastane lead'in **fiyat-keşif birleşimi** beklentisini AI'ye yüklüyor. Auto-mode kullanıldığı için (`solo_fiyat` ve `demo_reply` zaten "auto") AI yanlış-segment guess yaparsa, mid lead'e "demoda harcamanızı sorup teklif veririm" mailı GİDİYOR. Sürtünme + halüsinasyon riski iki yönlü.

### Alt-3: Tek demo, kurucu manuel açar (AI ajan demo flow'u hiç yönetmez)
**Reddedildi.** AI ajan'ın değer önerisi: hot signal'i ölçeklemek. Demo bildirimi + zaman önerme + onay AI'da kalmalı; sadece içerik (teklif) insan'a geçmeli. Bu karar tam orta yolu çiziyor.

## 6. Doğrulama

Karar şu davranışsal kontroller ile doğrulanır (`docs/playbook-v2/TASKS.md` TG1 ve TG5 kapsamında):

- [ ] `lib/config/playbooks.ts` mid.reply.guidance: "demoda net teklif" geçmiyor; bunun yerine "20 dk'lık demoda sistemi gösterelim; ardından harcamanızı kıyaslayıp teklifi ayrı bir görüşmede sunarız" gibi 2-adımlı tanım var.
- [ ] `lib/config/playbooks.ts` hospital.reply.guidance: aynı kontrolün hastane versiyonu.
- [ ] `docs/PRICING.md §10` "Satış akışı (mid/hastane)" 2-adımlı tanımla yeniden yazıldı.
- [ ] `tests/playbooks.test.ts` mid/hospital reply guidance'ının "demo" içermesini ve "teklif"i içermemesini doğrulayan smoke test geçer.
- [ ] PRICING.md ve playbooks.ts arasında "demoda teklif" / "demoda net fiyat" gibi ifadeler için `rg "demoda.*(teklif|fiyat|net)"` 0 hit verir.

## 7. Etki Alanı

Bu karar, AI ajanın **mesaj kalıbı** + **PRICING dokümantasyonu** kapsamında değiştirir. Şu alanları **değiştirmez**:
- Guardrail kuralları (mid/hospital'de fiyat yasağı zaten var, dokunulmadı).
- Action modes (`ACTION_MODES`).
- Lead/segment data modeli.
- AI sınıflama prompt'u.
- Outbound cold sekansı.

## 8. Referanslar

- [`CONTEXT.md` karar #2](../../CONTEXT.md) — Karar satırı (2026-05-26 güncellendi).
- [`docs/PRICING.md` §10](../PRICING.md#10-operasyon--sat%C4%B1%C5%9F-playbook) — Mevcut "demoda harcama sorusu" satırı (TG5'te güncellenecek).
- [`docs/playbook-v2/`](../playbook-v2/) — Bu kararın implementasyon paketi (SPEC-DELTA, IMPLEMENTATION, TASKS, PROMPT).
- Grilling oturumu handoff: `/var/folders/5t/.../saas-seller-handoff-2026-05-26.md` (geçici dosya; karar S1+S2 + "Açık karar" bölümü).
