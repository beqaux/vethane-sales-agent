import { eventRepo } from "../db/repositories/event";

/** Yapısal olay loglama: events tablosuna yazar + konsola düşer (best-effort). */
export const logger = {
  async event(type: string, leadId: string | null, payload?: unknown): Promise<void> {
    console.log(`[event] ${type} lead=${leadId ?? "-"}`, payload ?? "");
    try {
      await eventRepo.log(type, leadId, payload);
    } catch (e) {
      console.error(`[event] log failed: ${type}`, e);
    }
  },
};
