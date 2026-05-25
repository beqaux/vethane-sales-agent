import { gmailAdapter } from "@/lib/adapters/gmail";
import { cronAuthorized } from "@/lib/util/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  try {
    const r = await gmailAdapter.watch();
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
