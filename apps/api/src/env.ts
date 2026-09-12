import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * หา project root (โฟลเดอร์ที่มี docker-compose.yml + apps/api/package.json)
 * จากตำแหน่ง module นี้ ทั้งตอน dev (apps/api/src) และตอน build (apps/api/dist/src)
 * เพื่อโหลด project .env ได้ถูกต้องไม่ว่า cwd จะเป็น root หรือ apps/api (เช่น `npm -w`)
 */
export function resolveProjectRoot(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", ".."), // dev: apps/api/src -> root
    join(here, "..", "..", "..", ".."), // built: apps/api/dist/src -> root
    process.cwd(),
    join(process.cwd(), ".."),
    join(process.cwd(), "..", ".."),
  ];
  for (const c of candidates) {
    try {
      if (
        existsSync(join(c, "docker-compose.yml")) &&
        existsSync(join(c, "apps", "api", "package.json"))
      ) {
        return c;
      }
    } catch {
      // ลอง candidate ถัดไป
    }
  }
  return null;
}

/**
 * โหลด project root .env แบบเงียบ (ไม่พิมพ์ค่า/secret ใด ๆ)
 * คืน path ที่โหลด หรือ null ถ้าหาไม่พบ (ให้ใช้ environment ตรง ๆ ต่อไป)
 */
export function loadProjectEnv(): string | null {
  const root = resolveProjectRoot();
  if (!root) return null;
  const path = join(root, ".env");
  if (!existsSync(path)) return null;
  dotenv.config({ path, quiet: true });
  return path;
}
