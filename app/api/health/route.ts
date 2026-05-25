import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, db: "ok", ts: new Date().toISOString() });
  } catch (e) {
    return Response.json({ ok: false, db: "error", error: String(e) }, { status: 500 });
  }
}
