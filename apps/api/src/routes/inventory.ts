import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import type { Store } from "../store.js";
import {
  normalizeIngredientName,
  normalizeIngredientUnit,
  normalizeLatestCost,
  normalizeManualStockOp,
  normalizeMovementQty,
  normalizeRecipeTargetType,
  normalizeRecipeLines,
  normalizeReorderThreshold,
  normalizeEnabled,
  normalizeStockQty,
  normalizeStockReason,
  normalizeStockReference,
  normalizeTargetId,
} from "../inventory/validation.js";
import { STOCK_OPS, type StockOp } from "../types.js";

export interface InventoryMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
  requireShopManager: (req: Request, res: Response, next: NextFunction) => void;
}

export interface InventoryRouterDeps {
  store: Store;
  middleware: InventoryMiddleware;
  clientIp: (req: Request) => string;
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

const ingredientBodySchema = z.object({
  name: z.unknown(),
  unit: z.unknown(),
  reorderThreshold: z.unknown().optional(),
  latestCost: z.unknown().optional(),
  initialOnHand: z.unknown().optional(),
});

const ingredientPatchSchema = z.object({
  name: z.unknown().optional(),
  reorderThreshold: z.unknown().optional(),
  latestCost: z.unknown().optional(),
  isEnabled: z.unknown().optional(),
});

const stockBodySchema = z.object({
  op: z.unknown(),
  qty: z.unknown(),
  reason: z.unknown(),
  reference: z.unknown().optional(),
});

const recipeBodySchema = z.object({
  targetType: z.unknown(),
  targetId: z.unknown(),
  lines: z.unknown(),
});

const ledgerQuerySchema = z.object({
  ingredientId: z.string().max(64).optional(),
  orderId: z.string().max(64).optional(),
  op: z.enum(STOCK_OPS as unknown as [StockOp, ...StockOp[]]).optional(),
  limit: z.string().max(10).optional(),
});

/**
 * Ticket 07 routes: วัตถุดิบ/สูตร/สต๊อก (Owner/Admin เท่านั้น)
 * - กฎธุรกิจอยู่ใน inventory/validation.ts (domain) และ store.ts (atomic + audit + ledger)
 * - router ทำแค่ validate รูปทรง input, เรียก store, ประกอบ DTO
 * - สูตรเป็น versioned (มีแต่สร้างเวอร์ชันใหม่ — ไม่มีแก้ไข/ลบ)
 * - stock_ledger เป็น append-only (มีแต่อ่าน — ไม่มีแก้ไข/ลบ)
 */
export function createInventoryRouter(deps: InventoryRouterDeps): express.Router {
  const { store, middleware, clientIp } = deps;
  const { requireAuth, requireCsrf, requireShopManager } = middleware;
  const router = express.Router();

  function actorOf(req: Request) {
    const actor = req.user!;
    return { actorId: actor.id, actorUsername: actor.username, ip: clientIp(req) };
  }

  // ---------- วัตถุดิบ ----------

  router.get("/api/inventory/ingredients", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const includeDisabled = req.query["includeDisabled"] === "1" || req.query["includeDisabled"] === "true";
      const items = await store.listIngredients({ includeDisabled });
      res.json({
        items: items.map((g) => ({ ...g, available: Math.round((g.onHand - g.reserved) * 1000) / 1000 })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/inventory/ingredients/:id", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const item = await store.getIngredient(req.params.id);
      if (!item) {
        res.status(404).json({ error: "ไม่พบวัตถุดิบ" });
        return;
      }
      res.json({
        item: { ...item, available: Math.round((item.onHand - item.reserved) * 1000) / 1000 },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/inventory/ingredients", requireAuth, requireCsrf, requireShopManager, async (req, res, next) => {
    try {
      const parsed = ingredientBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const b = parsed.data;
      let input: { name: string; unit: string; reorderThreshold: number; latestCost: number; initialOnHand: number };
      try {
        input = {
          name: normalizeIngredientName(b.name),
          unit: normalizeIngredientUnit(b.unit),
          reorderThreshold: normalizeReorderThreshold(b.reorderThreshold ?? 0),
          latestCost: normalizeLatestCost(b.latestCost ?? 0),
          initialOnHand: normalizeStockQty(b.initialOnHand ?? 0, "ยอดเริ่มต้น"),
        };
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลวัตถุดิบไม่ถูกต้อง" });
        return;
      }
      const item = await store.createIngredient(input, actorOf(req));
      res.status(201).json({
        item: { ...item, available: Math.round((item.onHand - item.reserved) * 1000) / 1000 },
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch(
    "/api/inventory/ingredients/:id",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = ingredientPatchSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const b = parsed.data;
        if (
          b.name === undefined &&
          b.reorderThreshold === undefined &&
          b.latestCost === undefined &&
          b.isEnabled === undefined
        ) {
          res.status(400).json({ error: "กรุณาระบุข้อมูลที่ต้องการแก้ไขอย่างน้อย 1 อย่าง" });
          return;
        }
        const patch: { name?: string; reorderThreshold?: number; latestCost?: number; isEnabled?: boolean } = {};
        try {
          if (b.name !== undefined) patch.name = normalizeIngredientName(b.name);
          if (b.reorderThreshold !== undefined) patch.reorderThreshold = normalizeReorderThreshold(b.reorderThreshold);
          if (b.latestCost !== undefined) patch.latestCost = normalizeLatestCost(b.latestCost);
          if (b.isEnabled !== undefined) patch.isEnabled = normalizeEnabled(b.isEnabled);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลวัตถุดิบไม่ถูกต้อง" });
          return;
        }
        const item = await store.updateIngredient(req.params.id, patch, actorOf(req));
        res.json({
          item: { ...item, available: Math.round((item.onHand - item.reserved) * 1000) / 1000 },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------- ธุรกรรมสต๊อกแบบ manual ----------

  router.post(
    "/api/inventory/ingredients/:id/stock",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = stockBodySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const b = parsed.data;
        let input: { op: "receive" | "return" | "waste" | "expire" | "personal_use" | "adjust"; qty: number; reason: string; reference: string | null };
        try {
          input = {
            op: normalizeManualStockOp(b.op),
            qty: normalizeMovementQty(b.qty),
            reason: normalizeStockReason(b.reason),
            reference: normalizeStockReference(b.reference ?? null),
          };
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลสต๊อกไม่ถูกต้อง" });
          return;
        }
        const { ingredient, entry } = await store.recordStockMovement(req.params.id, input, actorOf(req));
        res.status(201).json({
          ingredient: { ...ingredient, available: Math.round((ingredient.onHand - ingredient.reserved) * 1000) / 1000 },
          entry,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get("/api/inventory/ledger", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const parsed = ledgerQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const limit = Math.min(Math.max(Number(parsed.data.limit ?? 50) || 50, 1), 200);
      res.json({
        entries: await store.listStockLedger({
          ingredientId: parsed.data.ingredientId,
          orderId: parsed.data.orderId,
          op: parsed.data.op,
          limit,
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------- สูตร (versioned — สร้างใหม่อย่างเดียว) ----------

  router.post("/api/inventory/recipes", requireAuth, requireCsrf, requireShopManager, async (req, res, next) => {
    try {
      const parsed = recipeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const b = parsed.data;
      let input: { targetType: "menu" | "option"; targetId: string; lines: { ingredientId: string; qty: number }[] };
      try {
        input = {
          targetType: normalizeRecipeTargetType(b.targetType),
          targetId: normalizeTargetId(b.targetId),
          lines: normalizeRecipeLines(b.lines),
        };
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลสูตรไม่ถูกต้อง" });
        return;
      }
      const recipe = await store.createRecipe(input, actorOf(req));
      res.status(201).json({ recipe });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/inventory/recipes", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const targetType = normalizeRecipeTargetType(req.query["targetType"]);
      const targetId = normalizeTargetId(req.query["targetId"]);
      res.json({ recipes: await store.listRecipes(targetType, targetId) });
    } catch (err) {
      if (err instanceof Error && (err.message.includes("เป้าหมายสูตร") || err.message.includes("เป้าหมาย"))) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.get("/api/inventory/recipes/latest", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const targetType = normalizeRecipeTargetType(req.query["targetType"]);
      const targetId = normalizeTargetId(req.query["targetId"]);
      const recipe = await store.getLatestRecipe(targetType, targetId);
      if (!recipe) {
        res.status(404).json({ error: "เป้าหมายนี้ยังไม่มีสูตร" });
        return;
      }
      res.json({ recipe });
    } catch (err) {
      if (err instanceof Error && (err.message.includes("เป้าหมายสูตร") || err.message.includes("เป้าหมาย"))) {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.get("/api/audit/inventory", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("inventory_", limit) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
