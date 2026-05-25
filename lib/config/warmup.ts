// Domain ısınma — yeni Workspace domaini yakmamak için kademeli günlük limit (SPEC §3.2.3).
export const WARMUP = {
  startCap: 8, // başlangıç: günde yeni-ilk-dokunuş
  rampPerWeek: 5,
  maxCap: 30,
} as const;

/** Başlangıçtan geçen güne göre o günkü gönderim limiti. */
export function currentDailyCap(daysSinceStart: number): number {
  const weeks = Math.max(0, Math.floor(daysSinceStart / 7));
  return Math.min(WARMUP.maxCap, WARMUP.startCap + weeks * WARMUP.rampPerWeek);
}
