import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PublicShell } from "../src/components/shell";

let triggerResizeObserver: (() => void) | null = null;

class TestResizeObserver {
  private readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    triggerResizeObserver = this.callback;
  }

  observe() {}

  disconnect() {
    if (triggerResizeObserver === this.callback) triggerResizeObserver = null;
  }
}

function customerNav(container: HTMLElement): HTMLElement {
  const nav = Array.from(container.querySelectorAll("nav")).find((candidate) => candidate.querySelector('a[href="/menu"]'));
  if (!nav) throw new Error("customer navigation was not rendered");
  return nav as HTMLElement;
}

function setScrollMetrics(nav: HTMLElement, scrollWidth: number, clientWidth: number, scrollLeft: number) {
  Object.defineProperties(nav, {
    scrollWidth: { configurable: true, value: scrollWidth },
    clientWidth: { configurable: true, value: clientWidth },
    scrollLeft: { configurable: true, writable: true, value: scrollLeft },
  });
}

describe("customer navigation scroll hints", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("shows only the hint for remaining content and updates on scroll, resize, and ResizeObserver", async () => {
    const { container } = render(
      <MemoryRouter>
        <PublicShell>
          <p>content</p>
        </PublicShell>
      </MemoryRouter>,
    );
    const nav = customerNav(container);
    setScrollMetrics(nav, 720, 320, 0);
    fireEvent(window, new Event("resize"));

    const startHint = container.querySelector('[data-testid="customer-nav-scroll-hint-start"]') as HTMLElement;
    const endHint = container.querySelector('[data-testid="customer-nav-scroll-hint-end"]') as HTMLElement;
    expect(startHint).toHaveAttribute("aria-hidden", "true");
    expect(endHint).toHaveAttribute("aria-hidden", "true");
    expect(startHint).toHaveClass("pointer-events-none", "opacity-0");
    expect(endHint).toHaveClass("pointer-events-none", "opacity-100");

    nav.scrollLeft = 300;
    fireEvent.scroll(nav);
    await waitFor(() => {
      expect(startHint).toHaveClass("opacity-100");
      expect(endHint).toHaveClass("opacity-100");
    });

    nav.scrollLeft = 400;
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(endHint).toHaveClass("opacity-0"));

    setScrollMetrics(nav, 320, 320, 0);
    triggerResizeObserver?.();
    await waitFor(() => {
      expect(startHint).toHaveClass("opacity-0");
      expect(endHint).toHaveClass("opacity-0");
    });
  });
});
