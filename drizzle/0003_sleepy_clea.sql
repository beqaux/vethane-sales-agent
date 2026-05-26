-- Mevcut duplicate inbound mesajları temizle (Pub/Sub at-least-once kaynaklı).
-- Her gmail_message_id için en eski createdAt'i koru, gerisini sil.
DELETE FROM "messages"
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY "gmail_message_id" ORDER BY "created_at"
    ) AS rn
    FROM "messages"
    WHERE "direction" = 'in' AND "gmail_message_id" IS NOT NULL
  ) t WHERE rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_inbound_gmail_msg" ON "messages" USING btree ("gmail_message_id") WHERE "messages"."direction" = 'in' AND "messages"."gmail_message_id" IS NOT NULL;