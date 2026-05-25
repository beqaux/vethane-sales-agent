// Modül açıklamaları (prompt'a enjekte; AI ürünü buradan anlatır).
export const MODULES = {
  danisma: {
    ad: "Danışma (Taban)",
    aciklama:
      "Randevu, müşteri & hasta yönetimi, randevudan türeyen klinik notları, doktor listesi, danışma raporları ve ücretsiz SMS (Verimor).",
  },
  muhasebe: {
    ad: "Muhasebe",
    aciklama:
      "Vet servisleri & fiyatlama, işlemler, giderler, gün sonu, aylık hedefler, kasa/banka transferi ve banka bakiye mutabakatı.",
  },
  ik: {
    ad: "İK / Bordro",
    aciklama:
      "Personel yönetimi, otomatik vardiya planlama, izin, bordro/puantaj. Rakiplerde olmayan en derin moat.",
  },
  analitik: {
    ad: "Yönetim Analitiği",
    aciklama: "Konsolide rapor + karşılaştırma; çok şubeli/büyük kliniklerde yönetim görünürlüğü.",
  },
  kafe: { ad: "Kafe", aciklama: "Kafe/perakende tezgâhı için POS + stok." },
  doktor: { ad: "Doktor", aciklama: "Veteriner rolüne 'Bugünüm' + 'Performansım'. Kişi başı ücret." },
  iletisim: { ad: "İletişim", aciklama: "Verimor üzerinden SMS (ücretsiz; BYO)." },
} as const;
