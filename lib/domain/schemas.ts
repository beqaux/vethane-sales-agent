import { z } from "zod";
import { CLASSIFICATIONS, SEGMENTS } from "./enums";

/** AI sınıflama çıktısı — generateObject ile zorlanır (SPEC §3.4.2). */
export const ClassificationSchema = z.object({
  cls: z.enum(CLASSIFICATIONS),
  confidence: z.number().min(0).max(1),
  segmentGuess: z.enum(SEGMENTS).optional(),
});
export type ClassificationResult = z.infer<typeof ClassificationSchema>;

/** Pub/Sub push zarfı. */
export const PubSubPushSchema = z.object({
  message: z.object({
    data: z.string(),
    messageId: z.string().optional(),
    publishTime: z.string().optional(),
  }),
  subscription: z.string().optional(),
});

/** Gmail bildirimi (message.data base64'ten çözülür). */
export const GmailNotificationSchema = z.object({
  emailAddress: z.string(),
  historyId: z.union([z.string(), z.number()]),
});
