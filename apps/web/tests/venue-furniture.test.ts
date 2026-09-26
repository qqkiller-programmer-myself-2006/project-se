import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildFurniture, type Track } from "../src/components/venueScenery";

/**
 * โต๊ะทั้งร้านใช้แคช geometry/material ร่วมกัน — key ต้องแยกทุกค่าที่ต่างกันตามสไตล์
 * (เคยใช้ key เดียว: โต๊ะพับได้ขาหนาของโต๊ะไม้ และฝาเหยือกทุกโต๊ะเป็นสีชมพูตามโต๊ะแรก)
 */
function buildAll(styles: ("wood" | "dark" | "folding" | "sala")[]) {
  const own: Track = (obj) => obj;
  const shared = { stoolGeo: new Map<string, THREE.BufferGeometry>(), mat: new Map<string, THREE.Material>() };
  return styles.map((style) => buildFurniture(style, "square", 4, own, shared));
}

function legWidth(group: THREE.Group, height: number): number {
  const leg = group.children.find(
    (c): c is THREE.Mesh =>
      c instanceof THREE.Mesh &&
      c.geometry instanceof THREE.BoxGeometry &&
      c.geometry.parameters.height === height &&
      Math.abs(c.position.y - height / 2) < 1e-6,
  );
  return (leg!.geometry as THREE.BoxGeometry).parameters.width;
}

function lidColor(group: THREE.Group): number {
  const lid = group.children
    .filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
    .reduce((top, c) => (c.position.y > top.position.y ? c : top));
  return (lid.material as THREE.MeshStandardMaterial).color.getHex();
}

describe("buildFurniture ใช้แคชร่วมกันโดยไม่ปนสไตล์", () => {
  it("โต๊ะพับขาบางแม้สร้างหลังโต๊ะไม้", () => {
    const [wood, folding] = buildAll(["wood", "folding"]);
    expect(legWidth(wood!.group, 0.75)).toBeCloseTo(0.07);
    expect(legWidth(folding!.group, 0.75)).toBeCloseTo(0.04);
  });

  it("ฝาเหยือกโต๊ะไม้ท็อปส้มเป็นสีชมพู โต๊ะอื่นเป็นสีเขียวฟ้า", () => {
    const [wood, dark] = buildAll(["wood", "dark"]);
    expect(lidColor(wood!.group)).toBe(0xf08bb4);
    expect(lidColor(dark!.group)).toBe(0x7fd3c4);
  });
});
