import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { messages } from "../schema";
import { toMessage } from "../mappers";
import type { MessageRepo } from "../../domain/ports";

export const messageRepo: MessageRepo = {
  async add(msg) {
    // Inbound mesajlarda gmail_message_id partial unique — concurrent webhook
    // tetiklemelerinde ikinci insert ON CONFLICT DO NOTHING ile sessizce yutulur.
    const rows = await db
      .insert(messages)
      .values({
        leadId: msg.leadId,
        direction: msg.direction,
        gmailMessageId: msg.gmailMessageId,
        subject: msg.subject,
        body: msg.body,
        classification: msg.classification,
        status: msg.status,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0] ? toMessage(rows[0]) : null;
  },

  async existsInbound(gmailMessageId) {
    const rows = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.gmailMessageId, gmailMessageId), eq(messages.direction, "in")))
      .limit(1);
    return rows.length > 0;
  },
};
