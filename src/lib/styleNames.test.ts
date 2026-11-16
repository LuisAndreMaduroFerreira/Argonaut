import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A state belongs to its component: .strip-tab-active, not .strip-tab.active. A bare .active
// class means something different in every component that sets it, and one stray rule for it
// would restyle all of them.
const GENERIC = [
  "active", "open", "missing", "selected", "done", "passed", "saved", "leaving", "error", "current",
  "wrong", "right", "missed", "dirty", "empty", "listening", "generating", "disabled", "hidden",
];

const stylesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "styles");

test("no stylesheet styles a generic state class", () => {
  const pattern = new RegExp(`\\.(${GENERIC.join("|")})(?![\\w-])`, "g");
  const found: string[] = [];
  for (const file of readdirSync(stylesDir).filter((name) => name.endsWith(".css"))) {
    // Comments may mention the words; only selectors count.
    const css = readFileSync(path.join(stylesDir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(pattern)) found.push(`${file}: ${match[0]}`);
  }
  assert.deepEqual(found, []);
});
