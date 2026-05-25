import { after } from "next/server";
import { inboundService } from "@/lib/wiring";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Pub/Sub push doğrulama: subscription endpoint'ine ?token=<PUBSUB_VERIFICATION_TOKEN> ekle.
function authorized(req: Request): boolean {
  const token = process.env.PUBSUB_VERIFICATION_TOKEN;
  if (!token) return false;
  return new URL(req.url).searchParams.get("token") === token;
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("forbidden", { status: 403 });
  // Hızlı 204 ack; ağır iş yanıttan sonra (Pub/Sub historyId'sini kullanmıyoruz — son gelenleri yokla + dedup).
  after(async () => {
    try {
      await inboundService.handle();
    } catch {
      /* hatalar inbound_error olarak loglanır */
    }
  });
  return new Response(null, { status: 204 });
}
