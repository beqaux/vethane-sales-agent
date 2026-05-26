// Segment playbook scriptleri — playbook'lar (Step 9) tüketir, AI prompt'una enjekte edilir.
// KRİTİK: mid/hospital guidance'ında ASLA fiyat/sayı yok; solo'da fiyat config'ten çekilir.

export const DISCOVERY_QUESTION =
  "Şu an muhasebe/gün-sonu, bordro & vardiya ve raporlamaya (muhasebeci + parçalı yazılım + kendi vaktiniz dahil) ayda kabaca ne harcadığınızı merak ediyorum.";

export const PLAYBOOKS = {
  solo: {
    cold: {
      goal: "Solo kliniği Vethane'in değerini anlatıp ücretsiz denemeye yönlendir.",
      guidance:
        "Kısa, samimi, tek bir net fayda. Vethane'i 'işletme yönetimi' olarak konumla (klinik yazılımının yerine değil, yanında). Denemeye davet et. Fiyat sorulmadıkça verme; sorulursa config'ten gelen açık fiyatı kullan.",
    },
    takip: {
      goal: "Nazik takip; farklı bir açıdan değer hatırlat.",
      guidance: "Israrcı olma. 1 cümle yeni değer + 'denemek ister misiniz?'.",
    },
    fiyatReply: {
      goal: "Açık fiyatı ver + vet sayısı sor.",
      guidance:
        "Fiyatı NET ve config'ten gelen rakamla ver (uydurma). KDV hariç olduğunu belirt. " +
        "priceText doktor sayısı bilinmiyorsa 1 ve 2 vet için iki örnek içerir — onu olduğu gibi aktar. " +
        "Sonda doğru fiyatlandırma için klinikte kaç veteriner ile çalıştıklarını sor: " +
        "'Doğru fiyatlandırma için klinikte kaç veteriner ile çalıştığınızı öğrenebilir miyim?' " +
        "Deneme linki, trial URL veya site adresi BAHSETME.",
    },
  },
  mid: {
    cold: {
      goal: "Polikliniği keşif sorusuyla demoya çek. FİYAT YOK.",
      guidance: `Karar-vericiye (klinik sahibi vet) iletilebilir tonda yaz. Acıyı işaret et: dağınık arka-ofis (muhasebeci + bordro + vardiya + raporlama). Tek bir keşif sorusu sor: "${DISCOVERY_QUESTION}" Hedef: 20 dk'lık demo. ASLA sayı/fiyat yazma.`,
    },
    takip: {
      goal: "Takip; demo daveti tazele. FİYAT YOK.",
      guidance: "Kısa, değer odaklı, demo CTA. Sayı yazma.",
    },
    reply: {
      goal: "Cevaba göre 2-adımlı satışa yönlendir (önce demo, sonra teklif). FİYAT YOK.",
      guidance:
        "Fiyat sorulursa: 'Klinik büyüklüğüne göre değişiyor. 20 dk'lık bir demoda sistemi göstereyim; " +
        "ardından, ne kadar arka-ofis yükünüz olduğunu birlikte gözden geçirip teklifi ayrı bir görüşmede sunarım.' " +
        `İlk demoda harcama sorma/teklif verme; o ayrı bir görüşme. Keşif sorusu: "${DISCOVERY_QUESTION}"`,
    },
  },
  hospital: {
    cold: {
      goal: "Hastaneyi keşif + demoya çek. FİYAT YOK. Daha kurumsal ton.",
      guidance: `Kurumsal, ölçek odaklı. Çok şubeli/çok personelli yönetim acısı (konsolide raporlama, bordro/vardiya). Keşif sorusu + demo. ASLA sayı/fiyat yazma.`,
    },
    takip: { goal: "Kurumsal takip; demo daveti.", guidance: "Kısa, ölçek değeri, demo CTA. Sayı yok." },
    reply: {
      goal: "2-adımlı satışa yönlendir (demo → ayrı teklif görüşmesi). FİYAT YOK.",
      guidance:
        "Fiyat sorulursa demoya yönlendir, sayı verme. Demo = sistem gösterimi; teklif demo SONRASI " +
        "ayrı görüşmede. " +
        `Keşif: "${DISCOVERY_QUESTION}"`,
    },
  },
  demoReply: {
    goal: "Demo isteğini onayla + uygun zaman iste; kurucu bilgilendirilecek.",
    guidance:
      "Demo talebini teyit et, kısa bir teşekkür, 2-3 uygun zaman dilimi sor. Kurucuya bildirim gidecek (sistem). Sayı/taahhüt verme.",
  },
  cikisReply: {
    goal: "Çıkış talebini nazikçe onayla.",
    guidance: "Kısa, kibar: listeden çıkarıldı, rahatsızlık için özür. Başka bir şey satmaya çalışma.",
  },
} as const;
