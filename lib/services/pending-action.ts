import { randomUUID } from "node:crypto";
import type { PendingActionKind } from "../domain/enums";
import type { PendingAction } from "../domain/types";
import type { PendingActionRepo } from "../domain/ports";

// ADR-0006 §2.5: 7 gün varsayılan TTL; expiresAt > now() koşulu callback'te check edilir.
export const DEFAULT_TTL_DAYS = 7;

export interface CreatePendingActionInput {
  kind: PendingActionKind;
  leadId: string;
  gmailDraftId?: string | null;
  gmailThreadId?: string | null;
  payload?: Record<string, unknown>;
  ttlDays?: number;
  /**
   * Önceden generate UUID. T7/T9 notify atmadan önce tokenPrefix'i bilmek
   * için id'yi client-side yaratır → callback_data'yı kurar → sonra repo'ya insert eder.
   */
  id?: string;
}

export interface CreatedPendingAction {
  pending: PendingAction;
  /** UUID'nin ilk 8 hex char'ı — callback_data prefix'i (act:<prefix>:<verb>). */
  tokenPrefix: string;
}

export interface PendingActionService {
  create(input: CreatePendingActionInput): Promise<CreatedPendingAction>;
  resolve(
    id: string,
    status: "resolved" | "cancelled" | "expired",
  ): Promise<boolean>;
  updatePayload(id: string, patch: Record<string, unknown>): Promise<void>;
  expireDue(now?: Date): Promise<number>;
  tokenPrefix(id: string): string;
}

export function createPendingActionService(
  repo: PendingActionRepo,
): PendingActionService {
  return {
    async create(input) {
      const id = input.id ?? randomUUID();
      const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS;
      const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
      const pending = await repo.create({
        id,
        kind: input.kind,
        leadId: input.leadId,
        gmailDraftId: input.gmailDraftId ?? null,
        gmailThreadId: input.gmailThreadId ?? null,
        payload: input.payload ?? {},
        expiresAt,
      });
      return { pending, tokenPrefix: pending.id.slice(0, 8) };
    },
    async resolve(id, status) {
      return repo.resolve(id, status);
    },
    async updatePayload(id, patch) {
      await repo.updatePayload(id, patch);
    },
    async expireDue(now = new Date()) {
      return repo.expireDue(now);
    },
    tokenPrefix(id) {
      return id.slice(0, 8);
    },
  };
}
