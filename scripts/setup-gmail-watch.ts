import { loadEnv } from "./_env";
loadEnv();

import http from "node:http";
import { google } from "googleapis";
import { SCOPES } from "../lib/adapters/gmail";

// Bir-kerelik: OAuth (Internal app, loopback) ile refresh_token al + Gmail watch kur.
// Çalıştır: pnpm tsx scripts/setup-gmail-watch.ts

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;

function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "", REDIRECT);
      const code = u.searchParams.get("code");
      if (code) {
        res.end("Tamam — terminale dönebilirsin.");
        server.close();
        resolve(code);
      } else {
        res.statusCode = 400;
        res.end("code bulunamadı");
      }
    });
    server.listen(PORT, () => console.log(`(Dinleniyor: ${REDIRECT})`));
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth zaman aşımı (5 dk)"));
    }, 300_000);
  });
}

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("HATA: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET .env'de yok.");
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("\n1) Bu URL'i tarayıcıda aç ve onayla:\n");
  console.log(url, "\n");

  const code = await waitForCode();
  const { tokens } = await oauth2.getToken(code);

  console.log("\n✅ refresh_token (bunu .env'e GMAIL_REFRESH_TOKEN= olarak yapıştır):\n");
  console.log(tokens.refresh_token, "\n");

  oauth2.setCredentials(tokens);

  if (process.env.PUBSUB_TOPIC) {
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const res = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName: process.env.PUBSUB_TOPIC,
        labelIds: ["INBOX"],
        labelFilterBehavior: "include",
      },
    });
    console.log(`✅ watch kuruldu. historyId=${res.data.historyId} expiration=${res.data.expiration}`);
  } else {
    console.log("ℹ️ PUBSUB_TOPIC yok — watch atlandı (cron/watch-renew sonra kurar).");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
