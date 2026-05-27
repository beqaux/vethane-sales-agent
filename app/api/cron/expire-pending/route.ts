import { pendingActionService, eventRepo } from "@/lib/wiring";
import { cronAuthorized } from "@/lib/util/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ADR-0006 §2.7 (E4): 7+ gün pending_action'ları 'expired'a alır.
 * Tap-anı lazy-expire ile birlikte ikinci savunma katmanı —
 * stale token'ların callback yüzeyinde "pending" görünmesini engeller.
 */
async function handle(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  try {
    const expired = await pendingActionService.expireDue();
    if (expired > 0) {
      await eventRepo.log("pending_action_expired", null, { count: expired });
    }
    return Response.json({ ok: true, expired });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
