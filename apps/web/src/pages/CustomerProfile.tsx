import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type LineStatus, type PublicCustomer } from "../lib/api";
import { Alert, Badge, dangerButtonClass, inputClass, PageHeader, Panel, primaryButtonClass, secondaryButtonClass, Spinner, successButtonClass } from "../components/ui";

export default function CustomerProfilePage({ onLoggedOut }: { onLoggedOut?: () => void }) {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [customer, setCustomer] = useState<PublicCustomer | null>(null);
  const [line, setLine] = useState<LineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileMsg, setProfileMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const [lineBusy, setLineBusy] = useState(false);
  const [lineMsg, setLineMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const me = await api.customerMe();
      setCustomer(me.customer);
      setName(me.customer.name);
      setEmail(me.customer.email ?? "");
      setLine(await api.lineStatus());
      // P2: ผลลัพธ์ redirect หลัง LINE callback (?line=linked / ?line=error&reason=...)
      // API ตั้ง query นี้ตอน redirect กลับจาก /api/customers/line/callback — ไม่เคยมี secret ใน query
      const lineResult = searchParams.get("line");
      if (lineResult === "linked") {
        setLineMsg({ tone: "success", text: "เชื่อม LINE สำเร็จแล้ว" });
      } else if (lineResult === "error") {
        const reason = searchParams.get("reason") ?? "internal";
        const text: Record<string, string> = {
          cancelled: "ยกเลิกการเชื่อม LINE แล้ว กรุณาเริ่มใหม่อีกครั้งหากต้องการเชื่อม",
          invalid_response: "ข้อมูลจาก LINE ไม่ครบถ้วน กรุณาเริ่มใหม่อีกครั้ง",
          expired_or_used: "ลิงก์หมดอายุหรือไม่ถูกต้อง กรุณาเริ่มเชื่อม LINE ใหม่อีกครั้ง",
          exchange_failed: "แลก authorization code ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
          verify_failed: "ยืนยันตัวตนผ่าน LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
          conflict: "LINE นี้ถูกเชื่อมกับบัญชีอื่นแล้ว หรือบัญชีนี้เชื่อมไว้แล้ว",
          unavailable: "ยังไม่เปิดใช้งานการเชื่อม LINE กรุณาลองใหม่ภายหลัง",
          internal: "เชื่อม LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
        };
        setLineMsg({ tone: "error", text: text[reason] ?? text["internal"]! });
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setProfileMsg({ tone: "error", text: "กรุณาระบุชื่อ" });
      return;
    }
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      const updated = await api.updateCustomerProfile({ name: name.trim(), email: email.trim() ? email.trim() : null });
      setCustomer(updated.customer);
      setProfileMsg({ tone: "success", text: "บันทึกข้อมูลแล้ว" });
    } catch (err) {
      setProfileMsg({ tone: "error", text: err instanceof Error ? err.message : "บันทึกไม่สำเร็จ" });
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPw || newPw.length < 8) {
      setPwMsg({ tone: "error", text: "กรุณากรอกรหัสผ่านปัจจุบันและรหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร" });
      return;
    }
    setPwBusy(true);
    setPwMsg(null);
    try {
      await api.changeCustomerPassword(currentPw, newPw);
      onLoggedOut?.();
      nav("/customer/login");
    } catch (err) {
      setPwMsg({ tone: "error", text: err instanceof Error ? err.message : "เปลี่ยนรหัสผ่านไม่สำเร็จ" });
    } finally {
      setPwBusy(false);
    }
  }

  async function startLineLink() {
    setLineBusy(true);
    setLineMsg(null);
    try {
      const { authorizeUrl } = await api.lineStart("/profile");
      window.open(authorizeUrl, "_blank", "noopener");
      setLineMsg({ tone: "info", text: "เปิดหน้า LINE แล้ว ทำรายการในแท็บใหม่ให้เสร็จ แล้วกด “ตรวจสอบสถานะ”" });
    } catch (err) {
      setLineMsg({ tone: "error", text: err instanceof Error ? err.message : "เริ่มเชื่อม LINE ไม่สำเร็จ" });
    } finally {
      setLineBusy(false);
    }
  }

  async function refreshLine() {
    setLineBusy(true);
    try {
      setLine(await api.lineStatus());
      setLineMsg(null);
    } catch (err) {
      setLineMsg({ tone: "error", text: err instanceof Error ? err.message : "ตรวจสถานะไม่สำเร็จ" });
    } finally {
      setLineBusy(false);
    }
  }

  async function unlinkLine() {
    setLineBusy(true);
    setLineMsg(null);
    try {
      await api.lineUnlink();
      setLine({ linked: false });
      setLineMsg({ tone: "success", text: "ยกเลิกการเชื่อม LINE แล้ว" });
    } catch (err) {
      setLineMsg({ tone: "error", text: err instanceof Error ? err.message : "ยกเลิกการเชื่อมไม่สำเร็จ" });
    } finally {
      setLineBusy(false);
    }
  }

  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      await api.customerLogout();
    } finally {
      onLoggedOut?.();
      nav("/customer/login");
    }
  }

  async function deleteAccount() {
    setDeleteBusy(true);
    setDeleteMsg(null);
    try {
      await api.deleteCustomerMe();
      onLoggedOut?.();
      nav("/register");
    } catch (err) {
      setDeleteMsg(err instanceof Error ? err.message : "ลบบัญชีไม่สำเร็จ");
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 text-center">
        <Spinner label="กำลังโหลดข้อมูลสมาชิก…" />
      </div>
    );
  }

  if (loadError || !customer) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-10">
        <Alert tone="error" role="alert">{loadError ?? "ไม่พบข้อมูลสมาชิก กรุณาเข้าสู่ระบบใหม่"}</Alert>
        <button type="button" onClick={() => void load()} className={secondaryButtonClass}>ลองใหม่</button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      <PageHeader
        title="โปรไฟล์ของฉัน"
        description="จัดการข้อมูลสมาชิก รหัสผ่าน และการเชื่อม LINE"
        actions={
          <button type="button" onClick={() => void logout()} disabled={logoutBusy} aria-busy={logoutBusy} className={secondaryButtonClass}>
            {logoutBusy ? "กำลังออก…" : "ออกจากระบบ"}
          </button>
        }
      />

      <Panel label="ข้อมูลสมาชิก">
        <h2 className="text-base font-bold text-ink-900">ข้อมูลสมาชิก</h2>
        <p className="mt-1 text-sm text-ink-600">เบอร์โทร {customer.phone ?? "—"} (ใช้เข้าสู่ระบบ เปลี่ยนไม่ได้)</p>
        <form onSubmit={saveProfile} className="mt-3 space-y-3">
          <div>
            <label htmlFor="pf-name" className="mb-1 block text-sm font-semibold text-ink-800">ชื่อ</label>
            <input id="pf-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
          </div>
          <div>
            <label htmlFor="pf-email" className="mb-1 block text-sm font-semibold text-ink-800">อีเมล (ไม่บังคับ)</label>
            <input id="pf-email" type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="เว้นว่างได้" />
          </div>
          {profileMsg && <Alert tone={profileMsg.tone} role={profileMsg.tone === "error" ? "alert" : "status"}>{profileMsg.text}</Alert>}
          <button type="submit" disabled={profileBusy} aria-busy={profileBusy} className={primaryButtonClass}>
            {profileBusy ? "กำลังบันทึก…" : "บันทึกข้อมูล"}
          </button>
        </form>
      </Panel>

      <Panel label="เปลี่ยนรหัสผ่าน">
        <h2 className="text-base font-bold text-ink-900">เปลี่ยนรหัสผ่าน</h2>
        <p className="mt-1 text-sm text-ink-600">เปลี่ยนแล้วต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์</p>
        <form onSubmit={changePassword} className="mt-3 space-y-3">
          <div>
            <label htmlFor="pf-cur" className="mb-1 block text-sm font-semibold text-ink-800">รหัสผ่านปัจจุบัน</label>
            <input id="pf-cur" type="password" className={inputClass} value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" required />
          </div>
          <div>
            <label htmlFor="pf-new" className="mb-1 block text-sm font-semibold text-ink-800">รหัสผ่านใหม่</label>
            <input id="pf-new" type="password" className={inputClass} value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" required placeholder="อย่างน้อย 8 ตัวอักษร" />
          </div>
          {pwMsg && <Alert tone={pwMsg.tone} role={pwMsg.tone === "error" ? "alert" : "status"}>{pwMsg.text}</Alert>}
          <button type="submit" disabled={pwBusy} aria-busy={pwBusy} className={secondaryButtonClass}>
            {pwBusy ? "กำลังเปลี่ยน…" : "เปลี่ยนรหัสผ่าน"}
          </button>
        </form>
      </Panel>

      <Panel label="การเชื่อม LINE">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-ink-900">การเชื่อม LINE</h2>
          {line?.linked ? <Badge tone="success">เชื่อมแล้ว</Badge> : <Badge tone="neutral">ยังไม่เชื่อม</Badge>}
        </div>
        <p className="mt-1 text-sm text-ink-600">
          {line?.linked
            ? `เชื่อมกับ LINE${line.displayName ? ` (${line.displayName})` : ""} แล้ว หนึ่งบัญชีเชื่อมได้หนึ่ง LINE เท่านั้น`
            : "เชื่อม LINE เพื่อใช้ฟีเจอร์ในอนาคต ระบบยืนยันตัวตนผ่าน LINE โดยตรง ไม่เก็บรหัสผ่าน LINE ของคุณ"}
        </p>
        {lineMsg && (
          <div className="mt-3">
            <Alert tone={lineMsg.tone === "info" ? "info" : lineMsg.tone} role={lineMsg.tone === "error" ? "alert" : "status"}>{lineMsg.text}</Alert>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {!line?.linked ? (
            <>
              <button type="button" onClick={() => void startLineLink()} disabled={lineBusy} aria-busy={lineBusy} className={successButtonClass}>
                {lineBusy ? "กำลังเริ่ม…" : "เชื่อม LINE"}
              </button>
              <button type="button" onClick={() => void refreshLine()} disabled={lineBusy} className={secondaryButtonClass}>
                ตรวจสอบสถานะ
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => void refreshLine()} disabled={lineBusy} className={secondaryButtonClass}>
                ตรวจสอบสถานะ
              </button>
              <button type="button" onClick={() => void unlinkLine()} disabled={lineBusy} aria-busy={lineBusy} className={dangerButtonClass}>
                {lineBusy ? "กำลังยกเลิก…" : "ยกเลิกการเชื่อม"}
              </button>
            </>
          )}
        </div>
      </Panel>

      <Panel label="ลบบัญชี">
        <h2 className="text-base font-bold text-red-800">ลบบัญชี</h2>
        <p className="mt-1 text-sm text-ink-600">
          ลบแล้วชื่อ เบอร์โทร อีเมล และการเชื่อม LINE จะถูกทำเป็นนิรนามทันทีและออกจากระบบทุกอุปกรณ์
          ประวัติคำสั่งซื้อเดิมยังอ้างรหัสภายในโดยไม่มีข้อมูลระบุตัวคุณ
        </p>
        {deleteMsg && <div className="mt-3"><Alert tone="error" role="alert">{deleteMsg}</Alert></div>}
        {!confirmDelete ? (
          <button type="button" onClick={() => setConfirmDelete(true)} className={`${dangerButtonClass} mt-3`}>
            ขอลบบัญชีของฉัน
          </button>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="w-full text-sm font-semibold text-red-800" role="alert">ยืนยันลบบัญชีถาวร? การกระทำนี้ย้อนกลับไม่ได้</p>
            <button type="button" onClick={() => void deleteAccount()} disabled={deleteBusy} aria-busy={deleteBusy} className={dangerButtonClass}>
              {deleteBusy ? "กำลังลบ…" : "ยืนยันลบบัญชี"}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleteBusy} className={secondaryButtonClass}>
              ยกเลิก
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}
