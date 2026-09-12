import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

describe("api client CSRF (หลาย tab, ไม่ cache)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return handler(String(url), init);
      }),
    );
    return calls;
  }

  const okUser = () => ({
    ok: true,
    status: 201,
    json: async () => ({ user: { id: "1", username: "s", roles: ["kitchen"], isActive: true, createdAt: "" } }),
  });

  it("อ่าน token จากคุกกี้ปัจจุบันทุกครั้ง ไม่เรียก /csrf ซ้ำเมื่อมีคุกกี้แล้ว", async () => {
    document.cookie = "csrf=tabA";
    const calls = stubFetch(() => okUser());
    await api.createUser("s", "Password11", ["kitchen"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/api/users");
    expect((calls[0]!.init?.headers as Record<string, string>)["x-csrf-token"]).toBe("tabA");
  });

  it("คุกกี้ rotate แล้ว mutation ถัดไปใช้ค่าใหม่ทันที (อีก tab เปลี่ยน token)", async () => {
    document.cookie = "csrf=tabA";
    const calls = stubFetch(() => okUser());
    await api.createUser("s", "Password11", ["kitchen"]);
    document.cookie = "csrf=tabB";
    await api.createUser("s", "Password11", ["kitchen"]);
    const headers = calls.map((c) => (c.init?.headers as Record<string, string>)["x-csrf-token"]);
    expect(headers).toEqual(["tabA", "tabB"]);
    expect(calls.every((c) => !c.url.includes("/api/auth/csrf"))).toBe(true);
  });

  it("CSRF ล้มเหลว (403) โยน error ทันทีโดยไม่ retry mutation", async () => {
    document.cookie = "csrf=stale";
    const calls = stubFetch(() => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "โทเค็น CSRF ไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง" }),
    }));
    await expect(api.createUser("s", "Password11", ["kitchen"])).rejects.toThrow(/CSRF/);
    expect(calls.filter((c) => c.url.includes("/api/users"))).toHaveLength(1);
  });
});
