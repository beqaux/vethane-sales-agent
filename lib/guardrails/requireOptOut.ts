import { BRAND } from "../config/runtime";
import type { Guardrail } from "./types";

// Cold mailde opt-out satırı zorunlu (servis deterministik ekler; bu doğrular).
export const requireOptOut: Guardrail = (d) => {
  if (!d.isCold) return { ok: true };
  return d.body.includes(BRAND.optOutText)
    ? { ok: true }
    : { ok: false, reason: "cold mailde opt-out satırı eksik" };
};
