import { defineConfig } from "drizzle-kit";
import { loadEnv } from "./scripts/_env";

loadEnv(); // .env'i process.env'e yükle (drizzle-kit otomatik yüklemez)

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
