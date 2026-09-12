import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectEnv, resolveProjectRoot } from "../src/env.js";
import { findMigrationFile } from "../src/store.js";

describe("project root / migration resolution (ไม่พึ่ง cwd)", () => {
  it("resolveProjectRoot ชี้โฟลเดอร์ที่มี docker-compose.yml + apps/api/package.json", () => {
    const root = resolveProjectRoot();
    expect(root).not.toBeNull();
    expect(existsSync(join(root!, "docker-compose.yml"))).toBe(true);
    expect(existsSync(join(root!, "apps", "api", "package.json"))).toBe(true);
  });

  it("findMigrationFile หาไฟล์ migration ทั้งสองระดับความลึก (src/dist) ได้", () => {
    for (const name of ["001_staff_accounts.sql", "002_credential_version.sql"]) {
      const path = findMigrationFile(name);
      expect(existsSync(path)).toBe(true);
      const sql = readFileSync(path, "utf8");
      if (name.startsWith("001")) expect(sql).toContain("CREATE TABLE IF NOT EXISTS users");
      else expect(sql).toContain("password_version");
    }
  });

  it("loadProjectEnv ไม่โยน error และไม่พิมพ์ secret (คืน path หรือ null)", () => {
    const logged: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    try {
      const result = loadProjectEnv();
      expect(result === null || typeof result === "string").toBe(true);
    } finally {
      console.log = origLog;
    }
    expect(logged.join("\n")).not.toMatch(/password|secret|DATABASE_URL=/i);
  });

  it("npm start ตรงกับ tsc output (dist/src) และ Dockerfile CMD", () => {
    const root = resolveProjectRoot();
    expect(root).not.toBeNull();
    const pkg = JSON.parse(
      readFileSync(join(root!, "apps", "api", "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const tsconfig = JSON.parse(
      readFileSync(join(root!, "apps", "api", "tsconfig.json"), "utf8"),
    ) as { compilerOptions?: { outDir?: string; rootDir?: string } };
    // tsconfig ใช้ rootDir "." + outDir "dist" => entry src/index.ts คอมไพล์เป็น dist/src/index.js
    expect(tsconfig.compilerOptions?.outDir).toBe("dist");
    expect(tsconfig.compilerOptions?.rootDir).toBe(".");
    expect(pkg.scripts?.["start"]).toBe("node dist/src/index.js");
    expect(pkg.scripts?.["bootstrap:prod"]).toBe("node dist/src/bootstrap.js");
    const docker = readFileSync(join(root!, "apps", "api", "Dockerfile"), "utf8");
    expect(docker).toContain('CMD ["node", "dist/src/index.js"]');
  });
});
