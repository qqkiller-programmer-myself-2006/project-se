import type { AuditInput } from "../store.js";
import type { PredictionFeature, PredictionModel } from "../types.js";

/**
 * Ticket 13: audit events ของ capacity/prediction
 * (mutation เขียนพร้อม audit แบบ all-or-nothing — detail ไม่มี PII/secrets)
 */

interface PredictActor {
  actorId?: string | null;
  actorUsername?: string | null;
  ip?: string | null;
}

export function predictionRequestedEvent(
  f: PredictionFeature,
  actor: PredictActor,
): AuditInput {
  const scope = f.orderId ? `order:${f.orderId.slice(0, 8)}` : (f.station ?? "all");
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "prediction_requested",
    targetId: f.id,
    detail: `พยากรณ์ ${scope} รอ ~${f.baselineMin} นาที (source:${f.source} ${f.modelVersion})`,
    ip: actor.ip ?? null,
    success: true,
  };
}

export function predictionModelUpdatedEvent(
  before: PredictionModel,
  after: PredictionModel,
  actor: PredictActor,
): AuditInput {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "prediction_model_updated",
    targetId: null,
    detail: `โมเดล ${before.version}→${after.version} enabled:${before.enabled}→${after.enabled}`.slice(0, 500),
    ip: actor.ip ?? null,
    success: true,
  };
}

export function predictionCompletedEvent(
  f: PredictionFeature,
  actor: PredictActor,
): AuditInput {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "prediction_completed",
    targetId: f.id,
    detail: `วัดจริง ${f.actualMin} นาที (baseline คลาด ${f.errorBaseline} / model คลาด ${f.errorModel})`.slice(0, 500),
    ip: actor.ip ?? null,
    success: true,
  };
}

export function predictionEvaluatedEvent(
  samples: number,
  maeBaseline: number | null,
  maeModel: number | null,
  actor: PredictActor,
): AuditInput {
  return {
    actorId: actor.actorId ?? null,
    actorUsername: actor.actorUsername ?? null,
    action: "prediction_evaluated",
    targetId: null,
    detail: `ประเมิน ${samples} ตัวอย่าง MAE baseline=${maeBaseline} model=${maeModel}`.slice(0, 500),
    ip: actor.ip ?? null,
    success: true,
  };
}
