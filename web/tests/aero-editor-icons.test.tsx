import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import UserAvatar from "@/components/UserAvatar";
import { AERO_EDITOR_ICONS, aeroEditorIcons } from "@/lib/aero-editor-icons";

const aeroDir = resolve(__dirname, "../src/themes/aero");
const aeroCss = readFileSync(resolve(aeroDir, "aero.css"), "utf8");

describe("Aero editor icons", () => {
  it("gives every listed control an empty icon named for it", () => {
    const icons = aeroEditorIcons(document);
    expect(Object.keys(icons)).toEqual([...AERO_EDITOR_ICONS]);
    for (const name of AERO_EDITOR_ICONS) {
      const icon = icons[name] as HTMLElement;
      expect(icon.classList.contains("mbe-icon")).toBe(true);
      expect(icon.dataset.aeroIcon).toBe(name);
      expect(icon.childNodes).toHaveLength(0);
    }
  });

  it("draws a bundled Vista picture for each one", () => {
    for (const name of AERO_EDITOR_ICONS) {
      const rule = aeroCss.match(new RegExp(`\\[data-aero-icon="${name}"\\] \\{\\s*background-image: url\\("\\./([^"]+)"\\)`));
      expect(rule, name).not.toBeNull();
      expect(() => readFileSync(resolve(aeroDir, rule?.[1] ?? ""))).not.toThrow();
    }
  });
});

describe("Aero polish", () => {
  it("marks profile pictures so Aero can frame them", () => {
    const { container } = render(<UserAvatar name="Demo" />);
    expect(container.firstElementChild).toHaveAttribute("data-user-avatar");
    expect(aeroCss).toContain('url("./ui/user-frame.png")');
  });

  it("keeps a switch's tick in its box by zeroing the slide, which survives minifying", () => {
    // `translate: none` next to `transform: none` is folded into one transform by the
    // production minifier, which drops the reset and lets the tick slide out of the box.
    expect(aeroCss).toMatch(/\.mu-switch \{\s*--switch-w: var\(--switch-h\);/);
    expect(aeroCss).not.toMatch(/transform: none;\s*translate: none;/);
  });
});
