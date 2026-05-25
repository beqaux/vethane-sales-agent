/** Vercel Cron, CRON_SECRET set'liyse Authorization: Bearer <secret> gönderir. */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
