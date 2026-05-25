import type { Guardrail } from "./types";

/** Alıcı suppression listesindeyse gönderimi engelle. */
export const suppressionCheck: Guardrail = (d, ctx) =>
  ctx.suppressed ? { ok: false, reason: `suppression listesinde: ${d.toEmail}` } : { ok: true };
