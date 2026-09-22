import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join, resolve } from "../src/meta/path.ts";
import { tmpdir } from "../src/meta/os.ts";
import {
  type Diagnostic,
  lintRoots,
  optionalFinding,
  strictByConfig,
  tsgolintPath,
} from "../tools/runtime/lint.ts";
import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";

describe("runtime lint configuration", () => {
  it("rejects abandoned async work, hidden promises, loose conditions, missing variants, unchecked OAuth imports and unsafe any", () => {
    const root = resolve(import.meta.dirname, "..");
    const dir = mkdtempSync(join(tmpdir(), "ana-runtime-lint-"));
    const oauth = join(dir, "src/backends/oauth");
    mkdirSync(oauth, { recursive: true });
    const fixture = join(oauth, "fixture.ts");
    const text = `
import { parseJsonAs as unchecked } from "${root}/src/meta/json-runtime.ts"; // REPORT no-restricted-imports
import { capturedJsonParse } from "${root}/src/meta/json-runtime.ts";
export const json = capturedJsonParse("{}");
export const parsed = unchecked<string>("1");
export const raw = JSON.parse("1"); // REPORT no-restricted-properties no-unsafe-assignment
Promise.resolve("lost"); // REPORT no-floating-promises
void Promise.resolve("still lost"); // REPORT no-floating-promises
if (Promise.resolve(false)) console.log("wrong branch"); // REPORT no-misused-promises strict-boolean-expressions
[1].forEach(async () => { await Promise.resolve(); }); // REPORT no-misused-promises
export function label(flag?: boolean): string {
  return flag ? "on" : "off"; // REPORT strict-boolean-expressions
}
export function partial(value: "ok" | "failed"): void {
  switch (value) { case "ok": break; default: break; } // REPORT switch-exhaustiveness-check
}
await Promise.resolve("owned");
void Promise.reject(new Error("handled")).catch(console.error);
export function decided(flag: boolean): string {
  return flag ? "on" : "off";
}
export function complete(value: "ok" | "failed"): void {
  switch (value) { case "ok": case "failed": break; }
}
`;
    writeFileSync(fixture, text);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, target: "ES2025", module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*.ts"],
      }),
    );
    try {
      const result = spawnTextSync(
        Bun.argv[0]!,
        [
          "--no-env-file",
          join(root, "node_modules/oxlint/bin/oxlint"),
          "-c",
          join(root, ".oxlintrc.json"),
          "--format=unix",
          fixture,
        ],
        {
          cwd: dir,
          timeout: 30_000,
          // The same escape from the `node` shim that `bun run lint` takes; without it this test
          // passes or fails on whether the shell that started it happens to carry a Node binary.
          env: { ...process.env, OXLINT_TSGOLINT_PATH: tsgolintPath() },
        },
      );
      expect(result.error).toBeNull();
      expect(result.status).toBe(1);
      const expected = text.split("\n").flatMap((line, index) => {
        const marked = /\/\/ REPORT (.+)$/.exec(line)?.[1];
        return marked === undefined
          ? []
          : marked
              .trim()
              .split(/\s+/)
              .map((rule) => `${index + 1}:${rule}`);
      });
      const actual = [
        ...result.stdout.matchAll(
          /fixture\.ts:(\d+):\d+:.*\[(?:Error|Warning)\/(?:typescript|eslint)\(([^)]+)\)\]/g,
        ),
      ].map(([, line, rule]) => `${line}:${rule}`);
      expect(actual.sort()).toEqual(expected.sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("optional lint findings", () => {
  const source = [
    "// oxlint-disable-next-line anti-slop/no-reflect-get -- why a/b",
    "/* oxlint-disable ana/no-deep-nesting, typescript/no-explicit-any */",
    "// eslint-disable-next-line anti-slop/no-reflect-get, eslint/no-console",
    "// oxlint-disable-next-line",
    "// oxlint-disable-next-line banana/no-peel",
  ].join("\n");
  const bytes = new TextEncoder().encode(source);
  // oxlint's spans for an unused comment: the whole comment, or the one rule of it that went unused.
  const unused = (text: string, from = 0): Diagnostic => {
    const offset = source.indexOf(text, from);
    return {
      message: "Unused oxlint-disable directive (no problems were reported).",
      severity: "warning",
      filename: "fixture.ts",
      labels: [{ span: { offset, length: text.length, line: 1, column: 1 } }],
    };
  };
  const coded = (code: string): Diagnostic => ({
    message: "m",
    code,
    severity: "error",
    filename: "fixture.ts",
  });

  it("takes the two repository plugins' findings and unused comments that name only their rules", () => {
    expect(optionalFinding(coded("anti-slop(no-reflect-get)"), bytes)).toBe(true);
    expect(optionalFinding(coded("ana(no-deep-nesting)"), bytes)).toBe(true);
    expect(
      optionalFinding(unused("// oxlint-disable-next-line anti-slop/no-reflect-get -- why a/b"), bytes),
    ).toBe(true);
    const line = source.indexOf("// eslint-disable");
    expect(optionalFinding(unused("anti-slop/no-reflect-get", line), bytes)).toBe(true);
  });

  it("keeps oxlint's own rules, and comments that also name one or name none, gating", () => {
    expect(optionalFinding(coded("typescript(no-floating-promises)"), bytes)).toBe(false);
    expect(optionalFinding(coded("eslint(no-console)"), bytes)).toBe(false);
    expect(
      optionalFinding(unused("/* oxlint-disable ana/no-deep-nesting, typescript/no-explicit-any */"), bytes),
    ).toBe(false);
    expect(optionalFinding(unused("eslint/no-console"), bytes)).toBe(false);
    expect(optionalFinding(unused("// oxlint-disable-next-line\n"), bytes)).toBe(false);
    expect(optionalFinding(unused("// oxlint-disable-next-line banana/no-peel"), bytes)).toBe(false);
    expect(optionalFinding({ ...unused("x"), labels: [] }, bytes)).toBe(false);
  });
});

describe("a clone's strict default", () => {
  it("is strict where the clone sets ana.lintStrict, and only there", () => {
    const dir = mkdtempSync(join(tmpdir(), "lint-strict-"));
    try {
      expect(strictByConfig(dir)).toBe(false);
      expect(spawnTextSync("git", ["init", "-q", dir]).status).toBe(0);
      expect(strictByConfig(dir)).toBe(false);
      spawnTextSync("git", ["-C", dir, "config", "ana.lintStrict", "yes"]);
      expect(strictByConfig(dir)).toBe(true);
      spawnTextSync("git", ["-C", dir, "config", "ana.lintStrict", "false"]);
      expect(strictByConfig(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the roots of a whole-tree lint", () => {
  it("leave packages/ui out until its own dependencies are installed, and nothing else", () => {
    const dir = mkdtempSync(join(tmpdir(), "lint-roots-"));
    try {
      const without = lintRoots(dir);
      mkdirSync(join(dir, "packages/ui/node_modules"), { recursive: true });
      const complete = lintRoots(dir);
      expect(complete).toContain("packages");
      expect(without).toEqual(complete.filter((root) => root !== "packages"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
