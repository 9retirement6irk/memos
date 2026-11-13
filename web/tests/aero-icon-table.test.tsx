import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as lucide from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const aeroDir = resolve(__dirname, "../src/themes/aero");
const aeroCss = readFileSync(resolve(aeroDir, "aero.css"), "utf8");

/** Every class lucide-react puts on an icon it draws, e.g. "trash-2" and "trash2" for Trash2Icon. */
const lucideClasses = (): Set<string> => {
  const classes = new Set<string>();
  const seen = new Set<unknown>();
  for (const icon of Object.values(lucide)) {
    if (seen.has(icon) || typeof icon !== "object" || icon === null || !("displayName" in icon)) continue;
    seen.add(icon);
    let markup = "";
    try {
      markup = renderToStaticMarkup(createElement(icon as unknown as lucide.LucideIcon));
    } catch {
      continue; // Icon and the other helpers need props; they are not icons.
    }
    for (const name of markup.match(/class="([^"]*)"/)?.[1].split(" ") ?? []) {
      if (name.startsWith("lucide-")) classes.add(name.slice("lucide-".length));
    }
  }
  return classes;
};

describe("Aero icon table", () => {
  it("names only icons lucide still draws", () => {
    // lucide renames icons now and then (smile-plus became face-slightly-smiling-plus), and a
    // renamed icon silently loses its Vista picture.
    const known = lucideClasses();
    const named = [...new Set([...aeroCss.matchAll(/\.lucide-([a-z0-9-]+)/g)].map((match) => match[1]))];
    expect(named.filter((name) => !known.has(name))).toEqual([]);
  });

  it("points every picture at a bundled file", () => {
    const urls = [...aeroCss.matchAll(/url\("\.\/([^"]+)"\)/g)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThan(80);
    expect(urls.filter((url) => !existsSync(resolve(aeroDir, url)))).toEqual([]);
  });

  it("marks the check-in item so it alone wears the Journal picture", () => {
    expect(aeroCss).toMatch(/svg\.lucide:is\([^)]*\[data-insert-item="mood"\][^)]*\) \{\s*--vi: url\("\.\/icons\/Journal_104\.png"\)/);
    // The same face adds reactions, which have no Vista picture.
    expect(aeroCss).not.toMatch(/\.lucide-face-slightly-smiling-plus/);
  });
});
