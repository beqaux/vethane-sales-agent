import type { OutboundDraft, GuardCtx, GuardResult } from "../domain/types";
import type { Guardrail } from "./types";
import { suppressionCheck } from "./suppressionCheck";
import { noPriceForBigSegment } from "./noPriceForBigSegment";
import { noPromises } from "./noPromises";
import { noBannedPhrasesOrTime } from "./noBannedPhrasesOrTime";
import { requireOptOut } from "./requireOptOut";

export type { Guardrail };
export {
  suppressionCheck,
  noPriceForBigSegment,
  noPromises,
  noBannedPhrasesOrTime,
  requireOptOut,
};

// Chain of Responsibility (IMPL §2.3): ilk ret'te durur.
export const guardrails: Guardrail[] = [
  suppressionCheck,
  noPriceForBigSegment,
  noPromises,
  noBannedPhrasesOrTime,
  requireOptOut,
];

export function runGuardrails(d: OutboundDraft, ctx: GuardCtx): GuardResult {
  for (const g of guardrails) {
    const r = g(d, ctx);
    if (!r.ok) return r;
  }
  return { ok: true };
}
