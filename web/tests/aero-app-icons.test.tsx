import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAeroManifest, useAeroAppIcons } from "@/hooks/useAeroAppIcons";

const setTheme = (appearance: string) => document.documentElement.setAttribute("data-theme", appearance);

const href = (selector: string) => document.querySelector(selector)?.getAttribute("href");

describe("useAeroAppIcons", () => {
  beforeEach(() => {
    setTheme("aero-light");
    document.head.innerHTML = `
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <link rel="manifest" href="/site.webmanifest" />
      <meta name="theme-color" content="#165caa" />
    `;
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:manifest"), revokeObjectURL: vi.fn() }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("swaps in the Aero icons, manifest and app name while Aero is on", () => {
    renderHook(() => useAeroAppIcons("WxNotes"));
    expect(href("link[rel~='icon']")).toContain("favicon");
    expect(href("link[rel~='icon']")).not.toBe("/favicon.svg");
    expect(document.querySelector("link[rel~='icon']")).toHaveAttribute("type", "image/png");
    expect(href("link[rel='apple-touch-icon']")).not.toBe("/apple-touch-icon.png");
    expect(href("link[rel='manifest']")).toBe("blob:manifest");
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "WxNotes");
  });

  it("puts Memos' own icons back when Aero is turned off", async () => {
    renderHook(() => useAeroAppIcons("WxNotes"));
    // The hook hears about the change through a MutationObserver, which reports after the microtask.
    await act(async () => {
      setTheme("light");
      await Promise.resolve();
    });
    expect(href("link[rel~='icon']")).toBe("/favicon.svg");
    expect(document.querySelector("link[rel~='icon']")).toHaveAttribute("type", "image/svg+xml");
    expect(href("link[rel='apple-touch-icon']")).toBe("/apple-touch-icon.png");
    expect(href("link[rel='manifest']")).toBe("/site.webmanifest");
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')).toBeNull();
  });

  it("changes nothing outside the Aero themes", () => {
    setTheme("paper");
    renderHook(() => useAeroAppIcons("WxNotes"));
    expect(href("link[rel~='icon']")).toBe("/favicon.svg");
    expect(href("link[rel='manifest']")).toBe("/site.webmanifest");
  });
});

describe("buildAeroManifest", () => {
  it("names the app after the instance and installs at the site root", () => {
    const manifest = buildAeroManifest("WxNotes", "#165caa");
    expect(manifest).toMatchObject({ name: "WxNotes", short_name: "WxNotes", display: "standalone", theme_color: "#165caa" });
    expect(manifest.start_url).toBe(`${window.location.origin}/`);
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512"]);
  });
});
