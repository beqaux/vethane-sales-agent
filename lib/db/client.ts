import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  // Lazy uyarı; build/test sırasında client kullanılmıyorsa sorun değil.
  // Çalışma anında gerçek sorguda hata fırlar.
}

const sql = neon(process.env.DATABASE_URL ?? "postgres://invalid");
export const db = drizzle(sql, { schema });
export type DB = typeof db;
