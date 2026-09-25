import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";
import { createApp } from "../apps/api/src/app.js";
import { createStoreFromEnv } from "../apps/api/src/store.js";
import { createStoreOccupancyProvider } from "../apps/api/src/reservations/occupancy.js";
import { DisabledLineProvider, LineNotConfiguredError } from "../apps/api/src/line/adapter.js";
import { RealLineProvider, realLineConfigFromEnv } from "../apps/api/src/line/real.js";

// Vercel serverless entry: env มาจาก Vercel Environment Variables (ไม่โหลด .env)
// สร้าง app ครั้งเดียวต่อ instance แล้ว reuse ข้าม invocation (pool/migration ทำครั้งเดียว)

function parseTrustedProxy(): string[] | boolean {
  const raw = (process.env["TRUSTED_PROXY"] ?? "").trim();
  if (!raw) return false;
  if (raw === "true") return true;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function buildApp(): Promise<Express> {
  const store = await createStoreFromEnv();
  let line;
  try {
    line = new RealLineProvider(realLineConfigFromEnv());
  } catch (err) {
    if (err instanceof LineNotConfiguredError) {
      line = new DisabledLineProvider();
    } else {
      throw err;
    }
  }
  return createApp({
    store,
    trustedProxy: parseTrustedProxy(),
    line,
    customerUiBaseUrl: (process.env["CUSTOMER_UI_URL"] ?? "").trim() || undefined,
    occupancy: createStoreOccupancyProvider(store),
  });
}

let appPromise: Promise<Express> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    appPromise ??= buildApp();
    const app = await appPromise;
    app(req, res);
  } catch (err) {
    // ล้มตอน init (เช่น DATABASE_URL ผิด) → ให้ retry ครั้งหน้า และไม่รั่วรายละเอียด
    appPromise = undefined;
    console.error("api init failed:", err instanceof Error ? err.message : "unknown");
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "service_unavailable" }));
  }
}
