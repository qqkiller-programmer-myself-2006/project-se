/**
 * Bootstrap Owner คนแรกด้วย credentials ที่ระบุชัดเจน
 * - ชื่อผู้ใช้: รับจาก --username หรือ BOOTSTRAP_USERNAME
 * - รหัสผ่าน: รับจาก BOOTSTRAP_PASSWORD หรือถามแบบซ่อน (hidden prompt) ไม่ผ่าน argv/history
 * - ห้ามมีรหัสผ่านตั้งต้นในโค้ด และไม่พิมพ์ secret ใด ๆ ออก log
 * - สร้างแบบ atomic ผ่าน store.createFirstOwner ปฏิเสธเมื่อมี Owner อยู่แล้ว
 *
 * วิธีใช้:
 *   $env:BOOTSTRAP_USERNAME = "owner1"; $env:BOOTSTRAP_PASSWORD = "รหัสผ่าน"
 *   npm run bootstrap -w apps/api
 *   หรือ: npm run bootstrap -w apps/api -- --username owner1   (ถามรหัสผ่านแบบซ่อน)
 */
import bcrypt from "bcryptjs";
import { loadProjectEnv } from "./env.js";
import { createStoreFromEnv } from "./store.js";

loadProjectEnv();

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
    if (a === `--${name}`) {
      const i = process.argv.indexOf(a);
      return process.argv[i + 1];
    }
  }
  return process.env[`BOOTSTRAP_${name.toUpperCase()}`];
}

/** ถามรหัสผ่านแบบซ่อน ไม่ echo ลง terminal และไม่ผ่าน shell history */
async function promptHidden(query: string): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(query);
  const input = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const wasRaw = stdin.isRaw ?? false;
    stdin.setEncoding("utf8");
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    const done = (value: string | null, err?: Error) => {
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\n");
      if (err) reject(err);
      else resolve(value ?? "");
    };
    stdin.on("data", function onData(chunk: string) {
      const s = typeof chunk === "string" ? chunk : String(chunk);
      for (const ch of s) {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") {
          stdin.removeListener("data", onData);
          done(buf);
          return;
        }
        if (ch === "\u0003") {
          stdin.removeListener("data", onData);
          done(null, new Error("ยกเลิกโดยผู้ใช้"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    });
  });
  return input;
}

const username = arg("username");
let password = process.env["BOOTSTRAP_PASSWORD"];

if (!username) {
  console.error("ต้องระบุชื่อผู้ใช้ผ่าน --username หรือ BOOTSTRAP_USERNAME (ไม่มีค่าเริ่มต้น)");
  process.exit(1);
}
if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
  console.error("ชื่อผู้ใช้ไม่ถูกต้อง (a-z 0-9 _ . - ยาว 3-32)");
  process.exit(1);
}
if (password === undefined) {
  if (!process.stdin.isTTY) {
    console.error("ต้องตั้ง BOOTSTRAP_PASSWORD (ไม่มี TTY ให้ถามแบบซ่อน)");
    process.exit(1);
  }
  try {
    password = await promptHidden("รหัสผ่าน Owner (อย่างน้อย 8 ตัวอักษร, ไม่เกิน 72 ไบต์): ");
  } catch {
    console.error("ยกเลิกการสร้าง Owner");
    process.exit(1);
  }
}
if (!password || password.length < 8) {
  console.error("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
  process.exit(1);
}
if (Buffer.byteLength(password, "utf8") > 72) {
  console.error("รหัสผ่านต้องไม่เกิน 72 ไบต์ (ขีดจำกัด bcrypt)");
  process.exit(1);
}

// Runtime ใช้ MySQL จริงเท่านั้น
const store = await createStoreFromEnv();
try {
  const hash = await bcrypt.hash(password, 10);
  const result = await store.createFirstOwner({
    username,
    passwordHash: hash,
    roles: ["owner"],
  });
  if (!result.created) {
    console.error("มี Owner อยู่แล้ว ไม่สร้างซ้ำ (ป้องกันการสมัคร Owner จากเว็บสาธารณะ)");
    process.exit(1);
  }
  // ห้ามพิมพ์รหัสผ่านออก log
  console.log(`สร้าง Owner แรกสำเร็จ: ${username}`);
} finally {
  await store.close?.();
}
