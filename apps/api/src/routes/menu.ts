import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import type { Store } from "../store.js";
import {
  compareMenuCategory,
  normalizeCategory,
  normalizeDescription,
  normalizeImageUrl,
  normalizeKind,
  normalizeMenuName,
  normalizeMenuStatus,
  normalizePrice,
  normalizeSortOrder,
} from "../menu/validation.js";
import { toPublicMenuItem, type MenuItem } from "../types.js";

export interface MenuMiddleware {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireCsrf: (req: Request, res: Response, next: NextFunction) => void;
  requireShopManager: (req: Request, res: Response, next: NextFunction) => void;
}

export interface MenuRouterDeps {
  store: Store;
  middleware: MenuMiddleware;
  clientIp: (req: Request) => string;
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

// รับรูปทรงดิบก่อน แล้ว normalize ด้วย domain rules (error ไทยจาก validation.ts)
// เพื่อให้กฎอยู่ที่เดียวกับ store (ไม่ duplicate semantics ที่ router)
const menuBodySchema = z.object({
  category: z.unknown(),
  name: z.unknown(),
  description: z.unknown().optional(),
  imageUrl: z.unknown().optional(),
  price: z.unknown(),
  kind: z.unknown(),
  status: z.unknown().optional(),
  sortOrder: z.unknown().optional(),
});

const menuPatchSchema = z.object({
  category: z.unknown().optional(),
  name: z.unknown().optional(),
  description: z.unknown().optional(),
  imageUrl: z.unknown().optional(),
  price: z.unknown().optional(),
  kind: z.unknown().optional(),
  status: z.unknown().optional(),
  sortOrder: z.unknown().optional(),
});

const listQuerySchema = z.object({
  includeArchived: z.enum(["0", "1", "true", "false"]).optional(),
  category: z.string().max(64).optional(),
  kind: z.enum(["food", "drink"]).optional(),
  status: z.enum(["available", "unavailable"]).optional(),
  q: z.string().max(120).optional(),
});

function groupPublic(items: MenuItem[]) {
  const groups = new Map<string, MenuItem[]>();
  for (const m of items) {
    const list = groups.get(m.category) ?? [];
    list.push(m);
    groups.set(m.category, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareMenuCategory(a, b))
    .map(([category, list]) => ({
      category,
      items: list.map(toPublicMenuItem),
    }));
}

/**
 * Ticket 04 routes: แคตตาล็อกสาธารณะ + จัดการเมนู (Owner/Admin)
 * - กฎธุรกิจอยู่ใน menu/validation.ts (domain) และ store.ts (atomic mutation + audit)
 * - router ทำแค่ validate รูปทรง input, เรียก store, ประกอบ DTO
 * - ตั้งใจไม่มี DELETE /api/menu/:id — archive แทน (ห้ามลบทำลายประวัติ)
 */
export function createMenuRouter(deps: MenuRouterDeps): express.Router {
  const { store, middleware, clientIp } = deps;
  const { requireAuth, requireCsrf, requireShopManager } = middleware;
  const router = express.Router();

  // Public catalog: ไม่ต้อง login — เฉพาะเมนูพร้อมขาย จัดกลุ่มตามหมวด
  router.get("/api/menu/public", async (_req, res, next) => {
    try {
      const items = await store.listPublicMenuItems();
      res.json({ groups: groupPublic(items) });
    } catch (err) {
      next(err);
    }
  });

  // หลังร้าน: รายการทั้งหมด (default ซ่อน archive) + filter
  router.get("/api/menu", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const q = parsed.data;
      const includeArchived = q.includeArchived === "1" || q.includeArchived === "true";
      let items = await store.listMenuItems({ includeArchived });
      if (q.category !== undefined) items = items.filter((m) => m.category === q.category);
      if (q.kind !== undefined) items = items.filter((m) => m.kind === q.kind);
      if (q.status !== undefined) items = items.filter((m) => m.status === q.status);
      const needle = (q.q ?? "").trim().toLowerCase();
      if (needle) {
        items = items.filter(
          (m) =>
            m.name.toLowerCase().includes(needle) ||
            m.category.toLowerCase().includes(needle) ||
            (m.description ?? "").toLowerCase().includes(needle),
        );
      }
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.get("/api/menu/:id", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const item = await store.getMenuItem(req.params.id);
      if (!item) {
        res.status(404).json({ error: "ไม่พบเมนู" });
        return;
      }
      res.json({ item });
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/menu", requireAuth, requireCsrf, requireShopManager, async (req, res, next) => {
    try {
      const parsed = menuBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: zodMessage(parsed.error) });
        return;
      }
      const b = parsed.data;
      // normalize ด้วย domain rules — error ไทยชัดเจน (ห้ามส่ง stack ภายใน)
      let input: {
        category: string;
        name: string;
        description: string | null;
        imageUrl: string | null;
        price: number;
        kind: "food" | "drink";
        status: "available" | "unavailable";
        sortOrder: number;
      };
      try {
        input = {
          category: normalizeCategory(b.category),
          name: normalizeMenuName(b.name),
          description: normalizeDescription(b.description ?? null),
          imageUrl: normalizeImageUrl(b.imageUrl ?? null),
          price: normalizePrice(b.price),
          kind: normalizeKind(b.kind),
          status: b.status === undefined ? "available" : normalizeMenuStatus(b.status),
          sortOrder: normalizeSortOrder(b.sortOrder ?? 0),
        };
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลเมนูไม่ถูกต้อง" });
        return;
      }
      const actor = req.user!;
      const created = await store.createMenuItem(input, {
        actorId: actor.id,
        actorUsername: actor.username,
        ip: clientIp(req),
      });
      res.status(201).json({ item: created });
    } catch (err) {
      next(err);
    }
  });

  router.patch(
    "/api/menu/:id",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const parsed = menuPatchSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: zodMessage(parsed.error) });
          return;
        }
        const b = parsed.data;
        if (
          b.category === undefined &&
          b.name === undefined &&
          b.description === undefined &&
          b.imageUrl === undefined &&
          b.price === undefined &&
          b.kind === undefined &&
          b.status === undefined &&
          b.sortOrder === undefined
        ) {
          res.status(400).json({ error: "กรุณาระบุข้อมูลที่ต้องการแก้ไขอย่างน้อย 1 อย่าง" });
          return;
        }
        // validate แต่ละฟิลด์ที่ส่งมาด้วย domain rules ก่อนเรียก store
        const patch: {
          category?: string;
          name?: string;
          description?: string | null;
          imageUrl?: string | null;
          price?: number;
          kind?: "food" | "drink";
          status?: "available" | "unavailable";
          sortOrder?: number;
        } = {};
        try {
          if (b.category !== undefined) patch.category = normalizeCategory(b.category);
          if (b.name !== undefined) patch.name = normalizeMenuName(b.name);
          if (b.description !== undefined) patch.description = normalizeDescription(b.description);
          if (b.imageUrl !== undefined) patch.imageUrl = normalizeImageUrl(b.imageUrl);
          if (b.price !== undefined) patch.price = normalizePrice(b.price);
          if (b.kind !== undefined) patch.kind = normalizeKind(b.kind);
          if (b.status !== undefined) patch.status = normalizeMenuStatus(b.status);
          if (b.sortOrder !== undefined) patch.sortOrder = normalizeSortOrder(b.sortOrder);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : "ข้อมูลเมนูไม่ถูกต้อง" });
          return;
        }
        const actor = req.user!;
        const updated = await store.updateMenuItem(req.params.id, patch, {
          actorId: actor.id,
          actorUsername: actor.username,
          ip: clientIp(req),
        });
        res.json({ item: updated });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    "/api/menu/:id/archive",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const actor = req.user!;
        const item = await store.archiveMenuItem(req.params.id, {
          actorId: actor.id,
          actorUsername: actor.username,
          ip: clientIp(req),
        });
        res.json({ item });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    "/api/menu/:id/restore",
    requireAuth,
    requireCsrf,
    requireShopManager,
    async (req, res, next) => {
      try {
        const actor = req.user!;
        const item = await store.restoreMenuItem(req.params.id, {
          actorId: actor.id,
          actorUsername: actor.username,
          ip: clientIp(req),
        });
        res.json({ item });
      } catch (err) {
        next(err);
      }
    },
  );

  // ตั้งใจไม่มี DELETE /api/menu/:id — archive แทน (ห้ามลบทำลายประวัติ)

  router.get("/api/audit/menu", requireAuth, requireShopManager, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number(req.query["limit"] ?? 100) || 100, 1), 500);
      res.json({ items: await store.listAudit("menu_", limit) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
