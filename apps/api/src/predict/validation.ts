import {
  PREDICTION_DEFAULT_THRESHOLD_MINUTES,
  PREDICTION_DEFAULT_TIMEOUT_MS,
  PREDICTION_LARGE_PARTY_EXTRA_MINUTES,
  PREDICTION_LARGE_PARTY_SIZE,
  PREDICTION_MODEL_VERSION_MAX,
  PREDICTION_RANGE_PLUS_MINUTES,
  PREDICTION_TIMEOUT_MAX_MS,
  PREDICTION_TIMEOUT_MIN_MS,
  QUEUE_STANDARD_PREP_MINUTES,
  type PredictionAccuracy,
  type QueueStation,
} from "../types.js";
import { normalizeStation, slotStartOf } from "../queue/validation.js";

/**
 * Ticket 13: กฎ validation/pure helpers ของ capacity + wait prediction
 * (ใช้ร่วม Memory/MySQL/route — ห้าม duplicate semantics ที่ router/store)
 * - baseline ต่อฝ่าย: wait = prep × (1 + queueAhead) + partyAdj
 *   (prep: ครัว 15 / เครื่องดื่ม 5 นาที; partyAdj +5 เมื่อ partySize > 4)
 * - ระดับคำสั่งซื้อ = งานช้าที่สุด (max ทุกฝ่าย); ช่วง [wait, wait+5]
 * - features เก็บ ณ จุดพยากรณ์เท่านั้น — ไม่มีอนาคต ไม่มี PII
 */

function fail(message: string): never {
  throw new Error(message);
}

/** จำนวนผู้ใช้บริการสำหรับพยากรณ์ (1–50; ว่าง → 2 คน) */
export function normalizePredictionPartySize(value: unknown): number {
  if (value === undefined || value === null || value === "") return 2;
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (!Number.isInteger(n)) fail("จำนวนผู้ใช้บริการต้องเป็นจำนวนเต็ม");
  if (n < 1) fail("จำนวนผู้ใช้บริการต้องมากกว่าศูนย์");
  if (n > 50) fail("จำนวนผู้ใช้บริการต้องไม่เกิน 50 คน");
  return n;
}

/** เวลานัดล่วงหน้า: UTC ISO ที่ parse ได้และต้องเป็นอนาคต (เทียบ now) */
export function normalizePredictionScheduledAt(value: unknown, now: Date): string {
  if (typeof value !== "string" || value.trim().length === 0) fail("กรุณาระบุเวลานัดรับ");
  const t = new Date(value.trim()).getTime();
  if (Number.isNaN(t)) fail("รูปแบบเวลานัดรับไม่ถูกต้อง");
  if (t <= now.getTime()) fail("เวลานัดรับต้องเป็นเวลาในอนาคต");
  return new Date(t).toISOString();
}

/** รุ่นโมเดล: 1–64 ตัวอักษร (trim) */
export function normalizeModelVersion(value: unknown): string {
  if (typeof value !== "string") fail("กรุณาระบุรุ่นโมเดล");
  const v = value.trim();
  if (!v) fail("กรุณาระบุรุ่นโมเดล");
  if (v.length > PREDICTION_MODEL_VERSION_MAX) {
    fail(`รุ่นโมเดลต้องไม่เกิน ${PREDICTION_MODEL_VERSION_MAX} ตัวอักษร`);
  }
  return v;
}

/** timeout adapter (ms): 50–5000 */
export function normalizePredictionTimeoutMs(value: unknown): number {
  if (value === undefined || value === null || value === "") return PREDICTION_DEFAULT_TIMEOUT_MS;
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (!Number.isInteger(n)) fail("timeout ต้องเป็นจำนวนเต็ม (มิลลิวินาที)");
  if (n < PREDICTION_TIMEOUT_MIN_MS || n > PREDICTION_TIMEOUT_MAX_MS) {
    fail(`timeout ต้องอยู่ระหว่าง ${PREDICTION_TIMEOUT_MIN_MS}–${PREDICTION_TIMEOUT_MAX_MS} มิลลิวินาที`);
  }
  return n;
}

/** threshold เปิดใช้โมเดล (นาที): 0–60 */
export function normalizePredictionThreshold(value: unknown): number {
  if (value === undefined || value === null || value === "") return PREDICTION_DEFAULT_THRESHOLD_MINUTES;
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) fail("เกณฑ์ความแม่นยำต้องเป็นตัวเลข");
  if (n < 0 || n > 60) fail("เกณฑ์ความแม่นยำต้องอยู่ระหว่าง 0–60 นาที");
  return Math.round(n * 100) / 100;
}

/** เวลาจริงที่วัดได้ (นาที): 0–1440 */
export function normalizeActualMinutes(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) fail("เวลาจริงต้องเป็นตัวเลข");
  if (n < 0 || n > 1440) fail("เวลาจริงต้องอยู่ระหว่าง 0–1440 นาที");
  return Math.round(n * 100) / 100;
}

/** เวลาทำมาตรฐานของฝ่าย (นาที) */
export function stationPrepMinutes(station: QueueStation): number {
  return QUEUE_STANDARD_PREP_MINUTES[normalizeStation(station)];
}

/**
 * Baseline ต่อฝ่าย (deterministic):
 * wait = prep × (1 + queueAhead) + (partySize > 4 ? 5 : 0)
 */
export function computeStationWaitMin(station: QueueStation, queueAhead: number, partySize: number): number {
  const prep = stationPrepMinutes(station);
  const ahead = Math.max(0, Math.floor(queueAhead));
  const party = normalizePredictionPartySize(partySize);
  return prep * (1 + ahead) + (party > PREDICTION_LARGE_PARTY_SIZE ? PREDICTION_LARGE_PARTY_EXTRA_MINUTES : 0);
}

/** ช่วงแสดงผล [wait, wait+5] */
export function waitRangeOf(waitMin: number): { rangeMin: number; rangeMax: number } {
  const w = Math.max(0, Math.round(waitMin));
  return { rangeMin: w, rangeMax: w + PREDICTION_RANGE_PLUS_MINUTES };
}

/** ชั่วโมง/วันฝั่งกรุงเทพ ณ จุดพยากรณ์ (ไม่พึ่ง Intl — deterministic) */
export function bangkokHourParts(at: Date): { hourOfDay: number; dayOfWeek: number } {
  const b = new Date(at.getTime() + 7 * 3600_000);
  return { hourOfDay: b.getUTCHours(), dayOfWeek: b.getUTCDay() };
}

/** คีย์สล็อต `station@slotStartISO` (ใช้ผูก feature กับช่วงกำลังผลิต — ไม่มี PII) */
export function predictionSlotKey(station: QueueStation, at: Date): string {
  return `${normalizeStation(station)}@${slotStartOf(at).toISOString()}`;
}

/** MAE (นาที) — null เมื่อไม่มีตัวอย่าง */
export function computeMae(errors: number[]): number | null {
  if (errors.length === 0) return null;
  const sum = errors.reduce((a, e) => a + Math.abs(e), 0);
  return Math.round((sum / errors.length) * 100) / 100;
}

export interface AccuracySample {
  baselineMin: number;
  predictedMin: number | null;
  source: "baseline" | "model";
  actualMin: number;
}

/** เทียบ MAE baseline vs model บนชุดเดียวกัน (AT18) */
export function evaluateAccuracySamples(
  samples: AccuracySample[],
  thresholdMinutes: number,
): { samples: number; maeBaseline: number | null; maeModel: number | null; meetsThreshold: boolean } {
  const baseErrors: number[] = [];
  const modelErrors: number[] = [];
  for (const s of samples) {
    baseErrors.push(s.actualMin - s.baselineMin);
    if (s.source === "model" && s.predictedMin !== null) {
      modelErrors.push(s.actualMin - s.predictedMin);
    }
  }
  const maeBaseline = computeMae(baseErrors);
  const maeModel = modelErrors.length > 0 ? computeMae(modelErrors) : null;
  const meetsThreshold =
    maeBaseline !== null && maeModel !== null && maeModel + thresholdMinutes < maeBaseline;
  return { samples: samples.length, maeBaseline, maeModel, meetsThreshold };
}

/**
 * Fixtures เทียบความแม่นยำแบบ deterministic (no leakage — ค่าคงที่ในโค้ด):
 * โมเดลตัวอย่างดีกว่า baseline บนชุดเดียวกัน (ใช้ประกอบ Owner ตัดสินใจ ไม่ใช่ข้อมูลจริง)
 */
export const PREDICTION_ACCURACY_FIXTURES: (AccuracySample & { name: string })[] = [
  { name: "kitchen-lunch-rush", baselineMin: 30, predictedMin: 22, source: "model", actualMin: 21 },
  { name: "drink-normal", baselineMin: 10, predictedMin: 8, source: "model", actualMin: 7 },
  { name: "kitchen-large-party", baselineMin: 35, predictedMin: 28, source: "model", actualMin: 29 },
  { name: "drink-peak", baselineMin: 15, predictedMin: 12, source: "model", actualMin: 11 },
  { name: "kitchen-preorder", baselineMin: 20, predictedMin: 18, source: "model", actualMin: 17 },
  { name: "drink-remake", baselineMin: 10, predictedMin: 9, source: "model", actualMin: 9 },
];

export function evaluateFixtureAccuracy(thresholdMinutes: number): PredictionAccuracy["fixtures"] {
  const r = evaluateAccuracySamples(PREDICTION_ACCURACY_FIXTURES, thresholdMinutes);
  return {
    name: "accuracy-fixtures-v1",
    samples: r.samples,
    maeBaseline: r.maeBaseline ?? 0,
    maeModel: r.maeModel ?? 0,
    modelWins: r.meetsThreshold,
  };
}
