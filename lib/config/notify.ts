// Hangi olaylar Telegram bildirimi tetikler (SPEC §3.5.1).
export const NOTIFY_ON: Record<string, boolean> = {
  demo: true, // demo isteği — birincil hot signal
  low_confidence: true, // düşük güvenli sınıflama → kurucuya sor
  error_auth: true, // OAuth/refresh kritik hatası
};

export function shouldNotify(eventType: string): boolean {
  return NOTIFY_ON[eventType] ?? false;
}
