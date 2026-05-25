import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

// Lazy init: neon() yalnız ilk gerçek sorguda (runtime) çağrılır.
// Aksi halde `next build` modül yüklerken geçersiz/eksik DATABASE_URL ile patlar.
function makeDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  return drizzle(neon(url), { schema });
}

type DbType = ReturnType<typeof makeDb>;

let cached: DbType | null = null;
function real(): DbType {
  if (!cached) cached = makeDb();
  return cached;
}

export const db = new Proxy({} as DbType, {
  get(_target, prop) {
    const target = real() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  },
});

export type DB = DbType;
