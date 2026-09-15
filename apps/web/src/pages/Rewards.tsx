import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LOYALTY_SOURCE_LABELS,
  REDEMPTION_STATUS_LABELS,
  api,
  type LoyaltyTransaction,
  type Reward,
  type RewardRedemption,
} from "../lib/api";
import {
  Alert,
  Badge,
  PageHeader,
  Panel,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../components/ui";
import { MotionReveal, Skeleton, StaggerItem, StaggerList } from "../components/motion";
import { ConnectionBanner, DemoBadge } from "../components/demo";
import { Icon } from "../components/icons";
import {
  DEMO_BALANCE,
  DEMO_LEDGER,
  DEMO_REDEMPTIONS,
  DEMO_REWARDS,
  isOfflineError,
} from "../lib/demo";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `web-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function quotaLabel(r: Reward): string {
  if (r.quotaTotal === null) return "ไม่จำกัดสิทธิ์";
  const left = Math.max(r.quotaTotal - r.quotaUsed, 0);
  return `เหลือ ${left} สิทธิ์`;
}

/**
 * หน้าคะแนนสะสมและรางวัลของลูกค้า (Ticket 10 — session ลูกค้าเท่านั้น):
 * - ดูยอด/ประวัติคะแนน, รางวัลพร้อมแลก + ยืนยันแลก (reserve), รายการแลกของตนเอง,
 *   สแกน QR Walk-in, ผูกคำสั่งซื้อ Guest
 * - ไม่เรียก endpoint หลังร้าน — การกระทำของพนักงานถูกซ่อนโดยออกแบบ (role-aware)
 */
export default function RewardsPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([]);
  const [ledger, setLedger] = useState<LoyaltyTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  const [redeemBusyId, setRedeemBusyId] = useState<string | null>(null);
  const [redeemMsg, setRedeemMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseMsg, setReleaseMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const [walkinCode, setWalkinCode] = useState("");
  const [walkinBusy, setWalkinBusy] = useState(false);
  const [walkinMsg, setWalkinMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const [guestOrderId, setGuestOrderId] = useState("");
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestMsg, setGuestMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setDemo(false);
    try {
      const [b, rw, mine, led] = await Promise.all([
        api.loyaltyBalance(),
        api.rewardsRedeemable(),
        api.myRedemptions(),
        api.loyaltyLedger(50),
      ]);
      setBalance(b.balance);
      setRewards(rw.rewards);
      setRedemptions(mine.redemptions);
      setLedger(led.entries);
    } catch (err) {
      // Prefer real API; deterministic demo data only when unreachable.
      if (isOfflineError(err)) {
        setBalance(DEMO_BALANCE);
        setRewards(DEMO_REWARDS);
        setRedemptions(DEMO_REDEMPTIONS);
        setLedger(DEMO_LEDGER);
        setDemo(true);
        setLoadError(null);
      } else {
        setLoadError(err instanceof Error ? err.message : "โหลดข้อมูลสะสมแต้มไม่สำเร็จ");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reserved = useMemo(() => redemptions.filter((r) => r.status === "reserved"), [redemptions]);

  async function redeem(reward: Reward) {
    if (redeemBusyId) return;
    setRedeemBusyId(reward.id);
    setRedeemMsg(null);
    try {
      const { redemption } = await api.rewardRedeem(reward.id, newIdempotencyKey());
      setRedeemMsg({ tone: "success", text: `แลก “${redemption.rewardName}” แล้ว รหัสอ้างอิง ${redemption.code} — แสดงรหัสนี้ที่ร้านเพื่อรับเครื่องดื่ม` });
      await load();
    } catch (err) {
      setRedeemMsg({
        tone: "error",
        text: isOfflineError(err)
          ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ในโหมดสาธิต — แลกคะแนนไม่ได้ กรุณาเชื่อมต่อเน็ตแล้วลองใหม่"
          : err instanceof Error ? err.message : "แลกคะแนนไม่สำเร็จ",
      });
    } finally {
      setRedeemBusyId(null);
    }
  }

  async function release(redemptionId: string) {
    if (!releaseReason.trim()) {
      setReleaseMsg({ tone: "error", text: "กรุณาระบุเหตุผลยกเลิก" });
      return;
    }
    setReleaseBusy(true);
    setReleaseMsg(null);
    try {
      await api.redemptionReleaseMine(redemptionId, releaseReason.trim());
      setReleaseMsg({ tone: "success", text: "ยกเลิกรายการและคืนคะแนนแล้ว" });
      setReleaseId(null);
      setReleaseReason("");
      await load();
    } catch (err) {
      setReleaseMsg({
        tone: "error",
        text: isOfflineError(err)
          ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ในโหมดสาธิต — ยกเลิกรายการไม่ได้"
          : err instanceof Error ? err.message : "ยกเลิกรายการไม่สำเร็จ",
      });
    } finally {
      setReleaseBusy(false);
    }
  }

  async function scanWalkin(e: React.FormEvent) {
    e.preventDefault();
    if (!walkinCode.trim()) {
      setWalkinMsg({ tone: "error", text: "กรุณากรอกรหัส QR ที่ได้รับจากร้าน" });
      return;
    }
    setWalkinBusy(true);
    setWalkinMsg(null);
    try {
      const { earned } = await api.walkinScan(walkinCode.trim());
      setWalkinMsg({
        tone: "success",
        text: earned ? "รับคะแนน Walk-in 1 แต้มแล้ว" : "รับคะแนนเรียบร้อยแล้ว (คะแนนนี้ถูกใช้ไปก่อนหน้า)",
      });
      setWalkinCode("");
      await load();
    } catch (err) {
      setWalkinMsg({
        tone: "error",
        text: isOfflineError(err)
          ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ในโหมดสาธิต — รับคะแนนไม่ได้"
          : err instanceof Error ? err.message : "สแกน QR ไม่สำเร็จ",
      });
    } finally {
      setWalkinBusy(false);
    }
  }

  async function linkGuest(e: React.FormEvent) {
    e.preventDefault();
    if (!guestOrderId.trim()) {
      setGuestMsg({ tone: "error", text: "กรุณากรอกรหัสคำสั่งซื้อ Guest" });
      return;
    }
    setGuestBusy(true);
    setGuestMsg(null);
    try {
      const { earned } = await api.guestLink(guestOrderId.trim());
      setGuestMsg({
        tone: "success",
        text: earned ? "ผูกคำสั่งซื้อและรับคะแนนเข้าแล้ว" : "ผูกคำสั่งซื้อแล้ว (คะแนนนี้มีผู้รับไปก่อนหน้า)",
      });
      setGuestOrderId("");
      await load();
    } catch (err) {
      setGuestMsg({
        tone: "error",
        text: isOfflineError(err)
          ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ในโหมดสาธิต — ผูกคำสั่งซื้อไม่ได้"
          : err instanceof Error ? err.message : "ผูกคำสั่งซื้อไม่สำเร็จ",
      });
    } finally {
      setGuestBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <Panel label="กำลังโหลดคะแนนสะสม">
          <Skeleton label="กำลังโหลดคะแนนสะสม…" lines={5} />
        </Panel>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-10">
        <Alert tone="error" role="alert">{loadError}</Alert>
        <button type="button" onClick={() => void load()} className={secondaryButtonClass}>ลองใหม่</button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      <PageHeader
        title="คะแนนสะสมและรางวัล"
        description="สะสม 1 แต้มต่อเครื่องดื่ม 1 หน่วยเมื่อรับเครื่องดื่มแล้ว แล้วนำแต้มมาแลกรางวัล"
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {demo ? <DemoBadge /> : null}
            <button
              type="button"
              onClick={() => void load()}
              aria-label="โหลดข้อมูลสะสมแต้มใหม่"
              className={secondaryButtonClass}
            >
              <Icon name="refresh" size={18} />
              โหลดใหม่
            </button>
          </span>
        }
      />

      {demo ? <ConnectionBanner onRetry={() => void load()} /> : null}

      <MotionReveal>
        <Panel label="ยอดคะแนนของฉัน">
        <h2 className="text-base font-bold text-ink-900">ยอดคะแนนของฉัน</h2>
        <p className="mt-2 flex items-baseline gap-2" aria-live="polite">
          <span className="text-4xl font-bold text-brand-700">{balance ?? 0}</span>
          <span className="text-sm font-medium text-ink-600">แต้ม</span>
        </p>
        {reserved.length > 0 && (
          <p className="mt-1 text-sm text-ink-600">มี {reserved.length} รายการรอร้านรับ (แต้มถูกกันวงเงินไว้ชั่วคราว)</p>
        )}
        </Panel>
      </MotionReveal>

      <Panel label="รางวัลพร้อมแลก">
        <h2 className="text-base font-bold text-ink-900">รางวัลพร้อมแลก</h2>
        {redeemMsg && (
          <div className="mt-3">
            <Alert tone={redeemMsg.tone} role={redeemMsg.tone === "error" ? "alert" : "status"}>{redeemMsg.text}</Alert>
          </div>
        )}
        {rewards.length === 0 ? (
          <p className="mt-2 text-sm text-ink-600">ยังไม่มีรางวัลพร้อมแลกในขณะนี้ กลับมาดูใหม่ภายหลัง</p>
        ) : (
          <StaggerList className="mt-3 space-y-3">
            {rewards.map((r, index) => {
              const afford = (balance ?? 0) >= r.pointsCost;
              return (
                <StaggerItem key={r.id} index={index} className="pa-lift flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink-900">{r.name}</p>
                    <p className="text-sm text-ink-600">{r.menuName} · ใช้ {r.pointsCost} แต้ม · {quotaLabel(r)}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!afford || redeemBusyId !== null}
                    aria-busy={redeemBusyId === r.id}
                    onClick={() => void redeem(r)}
                    className={primaryButtonClass}
                    aria-label={afford ? `แลก ${r.name} ใช้ ${r.pointsCost} แต้ม` : `${r.name} แต้มไม่พอ (ต้องใช้ ${r.pointsCost} แต้ม)`}
                  >
                    {redeemBusyId === r.id ? "กำลังแลก…" : afford ? `แลก (${r.pointsCost} แต้ม)` : "แต้มไม่พอ"}
                  </button>
                </StaggerItem>
              );
            })}
          </StaggerList>
        )}
      </Panel>

      <Panel label="รายการแลกของฉัน">
        <h2 className="text-base font-bold text-ink-900">รายการแลกของฉัน</h2>
        {releaseMsg && (
          <div className="mt-3">
            <Alert tone={releaseMsg.tone} role={releaseMsg.tone === "error" ? "alert" : "status"}>{releaseMsg.text}</Alert>
          </div>
        )}
        {redemptions.length === 0 ? (
          <p className="mt-2 text-sm text-ink-600">ยังไม่เคยแลกรางวัล แลกครั้งแรกจากรายการด้านบนได้เลย</p>
        ) : (
          <StaggerList className="mt-3 space-y-3">
            {redemptions.map((r, index) => (
              <StaggerItem key={r.id} index={index} className="rounded-xl border border-ink-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 font-semibold text-ink-900">
                    {r.rewardName} <span className="font-normal text-ink-500">({r.code})</span>
                  </p>
                  <Badge tone={r.status === "consumed" ? "success" : r.status === "released" ? "neutral" : "brand"}>
                    {REDEMPTION_STATUS_LABELS[r.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-ink-600">ขอแลกเมื่อ {fmtTime(r.createdAt)}</p>
                {r.status === "reserved" && (
                  <div className="mt-2">
                    {releaseId === r.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void release(r.id);
                        }}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <div className="min-w-0 flex-1 basis-48">
                          <label htmlFor={`release-reason-${r.id}`} className="mb-1 block text-sm font-semibold text-ink-800">
                            เหตุผลยกเลิก
                          </label>
                          <input
                            id={`release-reason-${r.id}`}
                            className={inputClass}
                            value={releaseReason}
                            onChange={(e) => setReleaseReason(e.target.value)}
                            placeholder="เช่น เปลี่ยนใจ"
                            maxLength={500}
                          />
                        </div>
                        <button type="submit" disabled={releaseBusy} aria-busy={releaseBusy} className={secondaryButtonClass}>
                          {releaseBusy ? "กำลังยกเลิก…" : "ยืนยันยกเลิก"}
                        </button>
                        <button
                          type="button"
                          disabled={releaseBusy}
                          onClick={() => {
                            setReleaseId(null);
                            setReleaseReason("");
                          }}
                          className={secondaryButtonClass}
                        >
                          ไว้ก่อน
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setReleaseId(r.id);
                          setReleaseReason("");
                          setReleaseMsg(null);
                        }}
                        className={secondaryButtonClass}
                      >
                        ยกเลิกรายการนี้
                      </button>
                    )}
                  </div>
                )}
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </Panel>

      <Panel label="สแกน QR Walk-in">
        <h2 className="text-base font-bold text-ink-900">สแกน QR Walk-in</h2>
        <p className="mt-1 text-sm text-ink-600">ขอรหัส QR จากพนักงานที่ร้าน (ใช้ได้ครั้งเดียวภายใน 10 นาที) รับ 1 แต้มต่อรหัส</p>
        <form onSubmit={scanWalkin} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-48">
            <label htmlFor="walkin-code" className="mb-1 block text-sm font-semibold text-ink-800">รหัส QR</label>
            <input
              id="walkin-code"
              className={inputClass}
              value={walkinCode}
              onChange={(e) => setWalkinCode(e.target.value)}
              placeholder="เช่น WALKIN-XXXX"
              autoComplete="off"
            />
          </div>
          <button type="submit" disabled={walkinBusy} aria-busy={walkinBusy} className={primaryButtonClass}>
            {walkinBusy ? "กำลังรับคะแนน…" : "รับคะแนน"}
          </button>
        </form>
        {walkinMsg && (
          <div className="mt-3">
            <Alert tone={walkinMsg.tone} role={walkinMsg.tone === "error" ? "alert" : "status"}>{walkinMsg.text}</Alert>
          </div>
        )}
      </Panel>

      <Panel label="ผูกคำสั่งซื้อ Guest">
        <h2 className="text-base font-bold text-ink-900">ผูกคำสั่งซื้อ Guest</h2>
        <p className="mt-1 text-sm text-ink-600">
          สั่งแบบไม่เข้าสู่ระบบด้วยเบอร์เดียวกับบัญชีนี้ใช่ไหม ผูกคำสั่งซื้อนั้นภายใน 24 ชั่วโมงเพื่อรับคะแนนที่ยังไม่มีผู้รับ
        </p>
        <form onSubmit={linkGuest} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-48">
            <label htmlFor="guest-order" className="mb-1 block text-sm font-semibold text-ink-800">รหัสคำสั่งซื้อ</label>
            <input
              id="guest-order"
              className={inputClass}
              value={guestOrderId}
              onChange={(e) => setGuestOrderId(e.target.value)}
              placeholder="รหัสคำสั่งซื้อ Guest"
              autoComplete="off"
            />
          </div>
          <button type="submit" disabled={guestBusy} aria-busy={guestBusy} className={primaryButtonClass}>
            {guestBusy ? "กำลังผูก…" : "ผูกคำสั่งซื้อ"}
          </button>
        </form>
        {guestMsg && (
          <div className="mt-3">
            <Alert tone={guestMsg.tone} role={guestMsg.tone === "error" ? "alert" : "status"}>{guestMsg.text}</Alert>
          </div>
        )}
      </Panel>

      <Panel label="ประวัติคะแนน">
        <h2 className="text-base font-bold text-ink-900">ประวัติคะแนน</h2>
        {ledger.length === 0 ? (
          <p className="mt-2 text-sm text-ink-600">ยังไม่มีประวัติคะแนน สั่งเครื่องดื่มแล้วรับที่ร้านเพื่อเริ่มสะสมแต้ม</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {ledger.map((t) => (
              <li key={t.id} className="flex items-baseline gap-3 rounded-xl border border-ink-200 px-3 py-2">
                <span
                  className={`min-w-16 text-right text-base font-bold tabular-nums ${t.points >= 0 ? "text-green-700" : "text-red-700"}`}
                  aria-label={t.points >= 0 ? `ได้รับ ${t.points} แต้ม` : `ใช้ ${-t.points} แต้ม`}
                >
                  {t.points >= 0 ? `+${t.points}` : t.points}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink-900">{LOYALTY_SOURCE_LABELS[t.source] ?? t.source}</span>
                  <span className="block truncate text-xs text-ink-500">{t.reason} · {fmtTime(t.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
