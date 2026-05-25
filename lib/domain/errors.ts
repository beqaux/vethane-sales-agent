// Hata kategorileri (IMPL §7.1).

export class AppError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Geçici dış servis hatası (Gmail/AI/Telegram 5xx/timeout) → retry edilir. */
export class ExternalServiceError extends AppError {}

/** AI çıktısı şema/parse hatası → retry, sonra kuyrukta beklet. */
export class AiError extends AppError {}

/** OAuth/refresh token geçersiz → dur + alarm. */
export class AuthError extends AppError {}

/** Geçersiz config (build/runtime). */
export class ConfigError extends AppError {}

/** Beklenen kayıt bulunamadı. */
export class NotFoundError extends AppError {}

/** Sınır doğrulama hatası (webhook/CSV/AI input). */
export class ValidationError extends AppError {}
