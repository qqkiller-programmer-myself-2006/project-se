import {
  PREDICTION_BASELINE_VERSION,
  PREDICTION_DEFAULT_TIMEOUT_MS,
  type PredictionSource,
} from "../types.js";

/**
 * Ticket 13: prediction adapter seam (local-first — ห้ามเรียกเครือข่ายจริงในเทสต์)
 * - production ยังไม่เลือกผู้ให้บริการ/วิธีฝึก (D09) — ตอนนี้ contract-only + fake
 * - กฎเหล็ก: timeout/error ใด ๆ fallback baseline ทันที พร้อม metadata ครบ
 *   (source/modelVersion/predictedAt/timeoutMs) + ข้อความไม่รับประกันที่ route/UI
 */

export class PredictionNotConfiguredError extends Error {
  code = "PREDICTION_NOT_CONFIGURED";
  constructor(message = "ยังไม่เปิดใช้งานโมเดลพยากรณ์ (ใช้เวลามาตรฐานแทน)") {
    super(message);
  }
}

export class PredictionTimeoutError extends Error {
  code = "PREDICTION_TIMEOUT";
  constructor(message = "โมเดลพยากรณ์ตอบช้าเกินไป (ใช้เวลามาตรฐานแทน)") {
    super(message);
  }
}

export class PredictionFailedError extends Error {
  code = "PREDICTION_FAILED";
}

export interface PredictionInput {
  /** รหัสคำสั่งซื้อ (หรือ null = ประมาณทั่วไปรายฝ่าย) — ไม่มี PII */
  orderId: string | null;
  station: "kitchen" | "drink" | null;
  partySize: number;
  queueAhead: number;
  unitsAhead: number;
  baselineMin: number;
}

export interface PredictionOutput {
  waitMin: number;
  modelVersion: string;
}

export interface PredictionProvider {
  readonly name: string;
  predict(input: PredictionInput): Promise<PredictionOutput>;
}

/** กรณีปิดโมเดล/ยังไม่ตั้งค่า — โยนทันทีเพื่อให้ route fallback baseline (ห้ามเงียบ) */
export class DisabledPredictionProvider implements PredictionProvider {
  readonly name = "disabled";
  predict(_input: PredictionInput): Promise<PredictionOutput> {
    throw new PredictionNotConfiguredError();
  }
}

export interface FakePredictionBehavior {
  /** จำลองโมเดลล้มเหลว */
  fail?: boolean;
  /** จำลอง timeout (ไม่ resolve จนกว่า test จะคุม — ใช้ latencyMs สูงแทน) */
  timeout?: boolean;
  /** หน่วงเวลาตอบ (ms) — ใช้ทดสอบ timeout race */
  latencyMs?: number;
  /** เวลาที่โมเดลตอบ (default = baseline − 3 นาที แต่ไม่ต่ำกว่า 1) */
  waitMin?: number;
  version?: string;
  errorMessage?: string;
}

/**
 * Fake สำหรับ tests: บันทึกทุก call ให้ contract tests ตรวจได้
 * ไม่แตะเครือข่ายจริง ไม่เก็บ PII ใด ๆ
 */
export class FakePredictionProvider implements PredictionProvider {
  readonly name = "fake";
  behavior: FakePredictionBehavior;
  calls: PredictionInput[] = [];

  constructor(behavior: FakePredictionBehavior = {}) {
    this.behavior = behavior;
  }

  async predict(input: PredictionInput): Promise<PredictionOutput> {
    this.calls.push({ ...input });
    const latency = this.behavior.timeout ? 60_000 : (this.behavior.latencyMs ?? 0);
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
    if (this.behavior.timeout) {
      throw new PredictionTimeoutError();
    }
    if (this.behavior.fail) {
      throw new PredictionFailedError(this.behavior.errorMessage ?? "โมเดลพยากรณ์ไม่สำเร็จ (fake)");
    }
    const waitMin = this.behavior.waitMin ?? Math.max(1, input.baselineMin - 3);
    return { waitMin, modelVersion: this.behavior.version ?? "fake-model-v1" };
  }
}

export interface FallbackResult {
  waitMin: number;
  source: PredictionSource;
  modelVersion: string;
  /** true เมื่อ fallback จากความล้มเหลว/timeout/disabled */
  fallback: boolean;
}

/**
 * เรียกโมเดลพร้อม timeout race — ล้มเหลว/timeout ปิดโมเดล → fallback baseline
 * (route บันทึก source/modelVersion ลง metadata + feature เสมอ)
 */
export async function predictWithFallback(
  provider: PredictionProvider | null,
  modelEnabled: boolean,
  input: PredictionInput,
  opts?: { timeoutMs?: number },
): Promise<FallbackResult> {
  const timeoutMs = opts?.timeoutMs ?? PREDICTION_DEFAULT_TIMEOUT_MS;
  if (!provider || !modelEnabled) {
    return { waitMin: input.baselineMin, source: "baseline", modelVersion: PREDICTION_BASELINE_VERSION, fallback: true };
  }
  try {
    const winner = await Promise.race([
      provider.predict(input).then((o) => ({ kind: "ok" as const, o })),
      new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)).then(
        (t) => t,
      ),
    ]);
    if (winner.kind === "timeout") {
      return { waitMin: input.baselineMin, source: "baseline", modelVersion: PREDICTION_BASELINE_VERSION, fallback: true };
    }
    const waitMin = Number(winner.o.waitMin);
    if (!Number.isFinite(waitMin) || waitMin < 0 || waitMin > 1440) {
      return { waitMin: input.baselineMin, source: "baseline", modelVersion: PREDICTION_BASELINE_VERSION, fallback: true };
    }
    return { waitMin: Math.round(waitMin), source: "model", modelVersion: winner.o.modelVersion, fallback: false };
  } catch {
    return { waitMin: input.baselineMin, source: "baseline", modelVersion: PREDICTION_BASELINE_VERSION, fallback: true };
  }
}
