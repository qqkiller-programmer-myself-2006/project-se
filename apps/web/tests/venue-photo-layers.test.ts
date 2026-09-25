import { describe, expect, it } from "vitest";
import { greenKeyAlpha, parallaxShift } from "../src/components/venuePhotoLayers";

describe("greenKeyAlpha", () => {
  it("keeps foliage pixels and cuts gray road, sky and bright signs", () => {
    // [r,g,b,a]: ใบไม้, ถนนเทา, ท้องฟ้าขาว, รถเข้ม
    const px = new Uint8ClampedArray([60, 140, 50, 255, 120, 120, 120, 255, 250, 250, 250, 255, 40, 42, 45, 255]);
    const kept = greenKeyAlpha(px);
    expect(kept).toBe(1);
    expect(px[3]).toBe(255);
    expect(px[7]).toBe(0);
    expect(px[11]).toBe(0);
    expect(px[15]).toBe(0);
  });
});

describe("parallaxShift", () => {
  it("pins depth 1 to the world and follows the camera at depth 0", () => {
    expect(parallaxShift({ x: 6, z: 12 }, { x: 4, z: 8 }, 1)).toEqual({ x: 0, z: 0 });
    expect(parallaxShift({ x: 6, z: 12 }, { x: 4, z: 8 }, 0)).toEqual({ x: 2, z: 4 });
  });
  it("shifts far layers less than near ones and clamps", () => {
    const far = parallaxShift({ x: 8, z: 8 }, { x: 4, z: 8 }, 0.3);
    const near = parallaxShift({ x: 8, z: 8 }, { x: 4, z: 8 }, 0.7);
    expect(far.x).toBeGreaterThan(near.x);
    expect(parallaxShift({ x: 100, z: 0 }, { x: 0, z: 0 }, 0).x).toBe(4);
  });
});
