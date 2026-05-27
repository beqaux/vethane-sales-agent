import { describe, it, expect } from "vitest";
import { stripQuotedReply } from "@/lib/util/email-parse";

describe("stripQuotedReply", () => {
  it("Turkish Gmail attribution + > quoted lines → sadece kullanıcı yanıtı kalır", () => {
    const body = `3 veteriner var

Vethane <info@vethane.com>, 27 May 2026 Çar, 01:54 tarihinde şunu yazdı:

> Merhaba,
>
> Sorunuz için teşekkürler.
> Aylık taban 1.950 ₺ + KDV...
> Doğru fiyatlandırma için klinikte kaç veteriner ile çalıştığınızı
> öğrenebilir miyim?
>
> Vethane — info@vethane.com`;

    expect(stripQuotedReply(body)).toBe("3 veteriner var");
  });

  it("English Gmail attribution → ilk satır kalır", () => {
    const body = `Thanks, sounds great.

On Mon, May 27, 2026 at 1:54 AM Vethane <info@vethane.com> wrote:

> Pricing details below...`;
    expect(stripQuotedReply(body)).toBe("Thanks, sounds great.");
  });

  it("Outlook 'Original Message' separator", () => {
    const body = `Cevap.

-----Original Message-----
From: sender@x.com
Subject: ...`;
    expect(stripQuotedReply(body)).toBe("Cevap.");
  });

  it("Outlook 'From:' header bloğu", () => {
    const body = `Kısa cevabım burada.

From: sender@x.com
Sent: Monday, May 27, 2026 1:54 AM
To: info@vethane.com`;
    expect(stripQuotedReply(body)).toBe("Kısa cevabım burada.");
  });

  it("Quoted text yoksa body değişmez", () => {
    expect(stripQuotedReply("fiyat nedir")).toBe("fiyat nedir");
    expect(stripQuotedReply("Merhaba, fiyat bilgisi alabilir miyim?")).toBe(
      "Merhaba, fiyat bilgisi alabilir miyim?",
    );
  });

  it("CRLF satır sonu varyantını da işler", () => {
    const body = "3\r\n\r\nVethane <info@vethane.com>, 27 May 2026 Çar, 01:54 tarihinde şunu yazdı:\r\n\r\n> Merhaba,";
    expect(stripQuotedReply(body)).toBe("3");
  });

  it("> ile başlayan satırlar quoted sayılır", () => {
    const body = `evet

> önceki mesaj
> devam`;
    expect(stripQuotedReply(body)).toBe("evet");
  });

  it("boş string güvenli", () => {
    expect(stripQuotedReply("")).toBe("");
  });
});
