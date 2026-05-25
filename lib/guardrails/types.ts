import type { OutboundDraft, GuardCtx, GuardResult } from "../domain/types";

export type Guardrail = (d: OutboundDraft, ctx: GuardCtx) => GuardResult;
