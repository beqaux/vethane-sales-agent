import { db } from "../client";
import { events } from "../schema";
import type { EventRepo } from "../../domain/ports";

export const eventRepo: EventRepo = {
  async log(type, leadId, payload) {
    await db.insert(events).values({
      type,
      leadId: leadId ?? null,
      payloadJson: payload ?? null,
    });
  },
};
