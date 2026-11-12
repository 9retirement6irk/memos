import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuthFooter from "@/components/AuthFooter";

vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
  loadLocale: vi.fn(),
}));
vi.mock("./LocalePicker", () => ({ LocalePickerButton: () => null }));

const aeroToggle = () => screen.getByRole("button", { name: "setting.preference.theme-aero-system" });

describe("AuthFooter theme toggles", () => {
  afterEach(() => localStorage.clear());

  it.each(["aero", "aero-dark", "aero-paper", "aero-system"])("lights the Aero button for %s", (theme) => {
    localStorage.setItem("memos-theme", theme);
    render(<AuthFooter />);
    expect(aeroToggle()).toHaveAttribute("aria-pressed", "true");
  });

  it("switches to Aero following the system", () => {
    localStorage.setItem("memos-theme", "default");
    render(<AuthFooter />);
    fireEvent.click(aeroToggle());
    expect(localStorage.getItem("memos-theme")).toBe("aero-system");
    expect(document.documentElement.getAttribute("data-theme")).toMatch(/^aero-/);
  });
});
