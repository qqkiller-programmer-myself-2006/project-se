import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MenuShowcase3D, type ShowcaseItem } from "../src/components/MenuShowcase3D";

const item: ShowcaseItem = { id: "pad-thai", name: "Pad Thai", price: 75, imageUrl: "/menu/pad-thai.jpg" };

function setReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: reduced,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderShowcase(items: ShowcaseItem[] = [item]) {
  return render(<MenuShowcase3D items={items} activeIndex={0} onActiveIndexChange={vi.fn()} />);
}

describe("MenuShowcase3D fallback", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses an accessible 2D image without mounting WebGL when reduced motion is preferred", () => {
    setReducedMotion(true);
    const { container } = renderShowcase();

    const image = screen.getByRole("img", { name: /Pad Thai/ });
    expect(image).toHaveAttribute("src", "/menu/pad-thai.jpg");
    expect(image).toHaveAttribute("alt", "รูปภาพเมนู Pad Thai");
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("width", "640");
    expect(image).toHaveAttribute("height", "480");
    expect(image).toHaveStyle({ aspectRatio: "4 / 3" });
    expect(container.querySelector("canvas")).not.toBeInTheDocument();
  });

  it("falls back to the real image when WebGL cannot be created", async () => {
    setReducedMotion(false);
    renderShowcase();

    const image = await screen.findByRole("img", { name: /Pad Thai/ });
    expect(image).toHaveAttribute("src", "/menu/pad-thai.jpg");
    expect(image).toHaveAttribute("loading", "eager");
  });

  it("renders a readable placeholder when the image is missing or fails", () => {
    setReducedMotion(true);
    const { rerender } = renderShowcase([{ id: "no-image", name: "Tom Yum", price: 80, imageUrl: null }]);
    expect(screen.getByRole("img", { name: /ไม่มีรูปภาพสำหรับเมนู Tom Yum/ })).toBeInTheDocument();

    rerender(<MenuShowcase3D items={[item]} activeIndex={0} onActiveIndexChange={vi.fn()} />);
    const image = screen.getByRole("img", { name: /Pad Thai/ });
    fireEvent.error(image);
    expect(screen.getByRole("img", { name: /ไม่มีรูปภาพสำหรับเมนู Pad Thai/ })).toBeInTheDocument();
  });
});
