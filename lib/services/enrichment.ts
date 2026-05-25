import * as cheerio from "cheerio";
import { extractEmails } from "../util/email-parse";
import type { LeadRepo, EventRepo } from "../domain/ports";
import type { Lead } from "../domain/types";
import type { EmailConfidence } from "../domain/enums";

const PATHS = ["", "/iletisim", "/contact", "/iletisim-bilgileri", "/hakkimizda", "/bize-ulasin"];

export function domainFromUrl(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function buildUrl(base: string, path: string): string {
  const b = base.startsWith("http") ? base : `https://${base}`;
  try {
    return new URL(path, b).toString();
  } catch {
    return b;
  }
}

export function extractEmailsFromHtml(html: string): string[] {
  const $ = cheerio.load(html);
  const emails = new Set<string>();
  $("a[href^='mailto:']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const e = href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    if (/.+@.+\..+/.test(e)) emails.add(e);
  });
  // Metin: tag'leri boşlukla değiştir (bitişik element metinlerinin birleşip e-postayı bozmasını önler).
  const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  for (const e of extractEmails(text)) emails.add(e);
  return [...emails];
}

export function pickBestEmail(
  emails: string[],
  domain: string | null,
): { email: string; confidence: EmailConfidence } | null {
  const filtered = emails.filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/i.test(e));
  if (filtered.length > 0) {
    const byDomain = domain ? filtered.find((e) => e.endsWith(`@${domain}`)) : undefined;
    const preferred =
      byDomain ??
      filtered.find((e) => /^(info|iletisim|bilgi|destek|contact|klinik)@/.test(e)) ??
      filtered[0];
    return { email: preferred, confidence: "high" };
  }
  if (domain) return { email: `info@${domain}`, confidence: "low" };
  return null;
}

export interface EnrichDeps {
  leads: LeadRepo;
  events: EventRepo;
  fetchFn?: typeof fetch;
}

export function createEnrichmentService(deps: EnrichDeps) {
  const doFetch = deps.fetchFn ?? fetch;

  return {
    async enrichLead(lead: Lead): Promise<{ email: string | null; confidence: EmailConfidence | null }> {
      if (lead.email) return { email: lead.email, confidence: lead.emailConfidence };
      if (!lead.website) return { email: null, confidence: null };

      const domain = domainFromUrl(lead.website);
      const found = new Set<string>();
      for (const p of PATHS) {
        try {
          const res = await doFetch(buildUrl(lead.website, p), {
            signal: AbortSignal.timeout(8000),
            redirect: "follow",
          });
          if (!res.ok) continue;
          const html = await res.text();
          for (const e of extractEmailsFromHtml(html)) found.add(e);
          if (found.size > 0) break;
        } catch {
          /* sayfa atla */
        }
      }

      const pick = pickBestEmail([...found], domain);
      if (!pick) {
        await deps.events.log("enrich_no_email", lead.id, { website: lead.website });
        return { email: null, confidence: null };
      }
      try {
        await deps.leads.setEmail(lead.id, pick.email, pick.confidence);
      } catch (e) {
        // muhtemelen e-posta benzersizlik çakışması — atla, logla
        await deps.events.log("enrich_conflict", lead.id, { email: pick.email, error: String(e) });
        return { email: null, confidence: null };
      }
      return pick;
    },
  };
}
