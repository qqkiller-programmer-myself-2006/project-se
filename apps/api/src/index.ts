import { createApp } from "./app.js";
import { loadProjectEnv } from "./env.js";
import { createStoreFromEnv } from "./store.js";
import { createStoreOccupancyProvider } from "./reservations/occupancy.js";
import { DisabledLineProvider } from "./line/adapter.js";
import { RealLineProvider, realLineConfigFromEnv } from "./line/real.js";
import { LineNotConfiguredError } from "./line/adapter.js";

// โหลด project .env (หา root จากตำแหน่ง module ไม่พึ่ง cwd) แบบเงียบ ไม่พิมพ์ secret
loadProjectEnv();

function parseTrustedProxy(): string[] | boolean {
  const raw = (process.env["TRUSTED_PROXY"] ?? "").trim();
  if (!raw) return false;
  if (raw === "true") return true;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const port = Number(process.env["API_PORT"] ?? 4000);
// Runtime ใช้ MySQL จริงเท่านั้น (createStoreFromEnv โยน error ถ้าไม่มี DATABASE_URL)
const store = await createStoreFromEnv();
// LINE: ยังไม่ตั้งค่า → DisabledLineProvider (routes ตอบ 503 fail-fast, ห้ามเงียบ)
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
const app = createApp({
  store,
  trustedProxy: parseTrustedProxy(),
  line,
  customerUiBaseUrl: (process.env["CUSTOMER_UI_URL"] ?? "").trim() || undefined,
  // Ticket 06: public snapshot นับโต๊ะ/ผู้ใช้บริการจากรอบที่เปิดอยู่จริง (sanitize แล้ว ไม่มี PII)
  occupancy: createStoreOccupancyProvider(store),
});

app.listen(port, () => {
  // ห้าม log secret ใด ๆ
  console.log(`staff-accounts API listening on port ${port}`);
});
