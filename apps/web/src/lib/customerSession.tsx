import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type PublicCustomer } from "./api";

/**
 * session ลูกค้าแหล่งเดียวของทั้งแอป
 *
 * เดิมเชลล์ถาม `/api/customers/me` ใหม่ทุกครั้งที่เปลี่ยนหน้า และแต่ละหน้า
 * ที่ต้องใช้ session ก็ถามของตัวเองซ้ำอีก — guest จึงได้ 401 กองใน console
 * จนกลบ error จริง และยิง request เกินจำเป็นทุกการนำทาง
 *
 * ตัวนี้โหลดครั้งเดียวตอนเปิดแอป แล้วให้หน้าอื่นอ่านต่อ
 * `refresh()` มีไว้เรียกตอน session เปลี่ยนจริงเท่านั้น (เข้าสู่ระบบ/สมัคร/ออก)
 */

export type CustomerSession = {
  customer: PublicCustomer | null;
  /** false จนกว่าจะรู้คำตอบรอบแรก — หน้าเว็บอย่าเพิ่งตัดสินว่า "ไม่ได้ล็อกอิน" */
  ready: boolean;
  /** ถามใหม่จาก server แล้วคืนคำตอบล่าสุด */
  refresh: () => Promise<PublicCustomer | null>;
  /** ล้างฝั่งเว็บทันทีโดยไม่ถาม server (ใช้หลังออกจากระบบ) */
  clear: () => void;
};

const CustomerSessionContext = createContext<CustomerSession | null>(null);

export function CustomerSessionProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<PublicCustomer | null>(null);
  const [ready, setReady] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      // endpoint นี้ตอบ 200 เสมอ — guest ได้ customer: null ไม่ใช่ 401
      const next = (await api.customerSession()).customer;
      if (alive.current) setCustomer(next);
      return next;
    } catch {
      // เครือข่ายล่มจริง ๆ เท่านั้นที่มาถึงตรงนี้ — ถือว่ายังไม่ได้ล็อกอิน
      if (alive.current) setCustomer(null);
      return null;
    } finally {
      if (alive.current) setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clear = useCallback(() => {
    setCustomer(null);
    setReady(true);
  }, []);

  const value = useMemo<CustomerSession>(
    () => ({ customer, ready, refresh, clear }),
    [customer, ready, refresh, clear],
  );

  return <CustomerSessionContext.Provider value={value}>{children}</CustomerSessionContext.Provider>;
}

/**
 * อ่าน session ลูกค้า
 *
 * ใช้ได้นอก provider ด้วย (เช่นเทสต์ที่ render หน้าเดียว) — จะได้สถานะ
 * "ยังไม่มีใครล็อกอิน" ที่ปลอดภัย แทนที่จะโยน error ทิ้งทั้งหน้า
 */
export function useCustomerSession(): CustomerSession {
  const ctx = useContext(CustomerSessionContext);
  const standalone = useStandaloneSession(ctx === null);
  return ctx ?? standalone;
}

/** โหมดสำรองเมื่อไม่มี provider ครอบ: ถามเองครั้งเดียว ไม่ผูกกับใคร */
function useStandaloneSession(enabled: boolean): CustomerSession {
  const [customer, setCustomer] = useState<PublicCustomer | null>(null);
  const [ready, setReady] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    try {
      const next = (await api.customerSession()).customer;
      if (alive.current) setCustomer(next);
      return next;
    } catch {
      if (alive.current) setCustomer(null);
      return null;
    } finally {
      if (alive.current) setReady(true);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const clear = useCallback(() => {
    setCustomer(null);
    setReady(true);
  }, []);

  return useMemo(() => ({ customer, ready, refresh, clear }), [customer, ready, refresh, clear]);
}
