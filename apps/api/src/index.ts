import { createApp } from "./app.js";
import { loadProjectEnv } from "./env.js";
import { createStoreFromEnv } from "./store.js";

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
const app = createApp({ store, trustedProxy: parseTrustedProxy() });

app.listen(port, () => {
  // ห้าม log secret ใด ๆ
  console.log(`staff-accounts API listening on port ${port}`);
});
