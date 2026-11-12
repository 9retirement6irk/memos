import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserTheme } from "@/hooks/useUserTheme";
import { isAeroTheme, isDarkTheme, loadTheme, resolveTheme, THEME_OPTIONS } from "@/utils/theme";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ userGeneralSetting: undefined }),
}));

/** Stubs the OS color scheme; flip `scheme.dark` and call `scheme.change()` to switch it. */
const stubScheme = () => {
  const changes = new EventTarget();
  const scheme = { dark: false, change: () => changes.dispatchEvent(new Event("change")) };
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return scheme.dark;
    },
    addEventListener: changes.addEventListener.bind(changes),
    removeEventListener: changes.removeEventListener.bind(changes),
  }));
  return scheme;
};

describe("Aero themes", () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fafafa" />
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0f0f0f" />
    `;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("offers the four Aero choices after memos' own", () => {
    expect(THEME_OPTIONS.map((option) => option.value)).toEqual([
      "system",
      "default",
      "default-dark",
      "paper",
      "aero-system",
      "aero",
      "aero-dark",
      "aero-paper",
    ]);
  });

  it.each([
    ["aero", "aero-light"],
    ["aero-dark", "aero-dark"],
    ["aero-paper", "aero-paper"],
  ])("loads %s as data-theme=%s and remembers it", (theme, appearance) => {
    loadTheme(theme);
    expect(document.documentElement).toHaveAttribute("data-theme", appearance);
    expect(localStorage.getItem("memos-theme")).toBe(theme);
  });

  it("counts Aero Dark as dark and every Aero variant as Aero", () => {
    expect(isDarkTheme("aero-dark")).toBe(true);
    expect(isDarkTheme("aero")).toBe(false);
    expect(isDarkTheme("aero-paper")).toBe(false);
    expect(["aero", "aero-dark", "aero-paper"].every((theme) => isAeroTheme(theme as "aero"))).toBe(true);
    expect(["default", "default-dark", "paper"].some((theme) => isAeroTheme(theme as "default"))).toBe(false);
  });

  it("resolves Aero's system choice to Aero Light or Aero Dark with the OS", () => {
    const scheme = stubScheme();
    expect(resolveTheme("aero-system")).toBe("aero");
    scheme.dark = true;
    expect(resolveTheme("aero-system")).toBe("aero-dark");
    // Memos' own system choice still stays in its own family.
    expect(resolveTheme("system")).toBe("default-dark");
  });

  it("follows OS changes while Aero's system choice is saved", () => {
    const scheme = stubScheme();
    loadTheme("aero-system");
    renderHook(() => useUserTheme());
    expect(document.documentElement).toHaveAttribute("data-theme", "aero-light");

    scheme.dark = true;
    scheme.change();
    expect(document.documentElement).toHaveAttribute("data-theme", "aero-dark");
    expect(localStorage.getItem("memos-theme")).toBe("aero-system");
  });

  it("colors the browser chrome like the caption bar, in both schemes for Aero's system choice", () => {
    loadTheme("aero-system");
    const [light, dark] = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content);
    expect(light).toBe("#165caa");
    expect(dark).toBe("#0b1726");

    loadTheme("aero-paper");
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#7a4a1c");
  });
});
