// Bağımlılık enjeksiyonu — gerçek repo + adapter'larla servisleri kurar (modül singleton).
import { leadRepo } from "./db/repositories/lead";
import { sequenceRepo } from "./db/repositories/sequence";
import { suppressionRepo } from "./db/repositories/suppression";
import { messageRepo } from "./db/repositories/message";
import { eventRepo } from "./db/repositories/event";
import { gmailAdapter } from "./adapters/gmail";
import { aiAdapter } from "./adapters/ai";
import { telegramAdapter } from "./adapters/telegram";
import { createOutboundService } from "./services/outbound";
import { createInboundService } from "./services/inbound";
import { createNotifyService } from "./services/notify";

export const notifyService = createNotifyService(telegramAdapter);

export const outboundService = createOutboundService({
  leads: leadRepo,
  seq: sequenceRepo,
  supp: suppressionRepo,
  msgs: messageRepo,
  events: eventRepo,
  mail: gmailAdapter,
  ai: aiAdapter,
});

export const inboundService = createInboundService({
  leads: leadRepo,
  seq: sequenceRepo,
  supp: suppressionRepo,
  msgs: messageRepo,
  events: eventRepo,
  mail: gmailAdapter,
  ai: aiAdapter,
  notify: notifyService,
});
