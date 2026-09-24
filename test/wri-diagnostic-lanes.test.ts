import { expect, it } from "bun:test";
import { readFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import {
  ANGLE_FILES,
  angleNumbers,
} from "../.claude/skills/whole-run-investigation/scripts/catalogue-shape.mjs";
import {
  intelligenceSessions,
  angleSessions,
} from "../.claude/skills/whole-run-investigation/scripts/manifest-inputs.mjs";
import { resolveSessions } from "../.claude/skills/whole-run-investigation/scripts/manifest-compose.mjs";
import { snapshotLines } from "../.claude/skills/whole-run-investigation/scripts/manifest-reporting.mjs";

const skill = join(import.meta.dirname, "../.claude/skills/whole-run-investigation");
const angles = ANGLE_FILES.map((file: string) => readFileSync(join(skill, "references", file), "utf8")).join(
  "\n",
);
const declared = new Map([
  ...intelligenceSessions(readFileSync(join(skill, "SKILL.md"), "utf8")),
  ...angleSessions(angles),
]);
const input = {
  diagnostics: true,
  angles,
  declared,
  notesPath: null,
  referenceNames: new Set(),
  consumerHardware: false,
};

it("adds each diagnostic lane once without reducing the numbered-angle allocation", () => {
  expect(declared.get("angle_31")).toHaveProperty(
    "body",
    expect.not.stringContaining("Boundary and repair angles"),
  );
  for (const [sessionsSpec, autoCount, count] of [
    [null, 0, 2],
    ["category_and_hook_yield,5", 0, 3],
    [null, 4, 6],
    [null, 36, 38],
  ] as const) {
    const sessions: { name: string; angleNumbers?: number[] }[] = resolveSessions({
      ...input,
      sessionsSpec,
      autoCount,
    }).sessions;
    expect(sessions).toHaveLength(count);
    expect(sessions.filter((session) => session.name === "category_and_hook_yield")).toHaveLength(1);
    expect(sessions.filter((session) => session.name === "diagnostic_follow_through")).toHaveLength(1);
    if (autoCount > 0) {
      expect(sessions.flatMap((session) => session.angleNumbers ?? []).sort((a, b) => a - b)).toEqual(
        angleNumbers(),
      );
      expect(sessions.find((session) => session.angleNumbers?.includes(15) === true)?.angleNumbers).toEqual([
        15,
      ]);
      expect(sessions.find((session) => session.angleNumbers?.includes(36) === true)?.angleNumbers).toEqual([
        36,
      ]);
    }
  }
});

it("assigns unavailable views too, and leaves unselected or new diagnostics with the primary", () => {
  const snapshot = {
    dir: "/snapshot",
    runId: "r",
    failedViews: [],
    status: {
      views: [
        { label: "r-scan", file: "r-scan.json", status: "ok" },
        { label: "builder", file: "builder.json", status: "ok" },
        { label: "review-yield", file: "review-yield.json", status: "ok" },
        { label: "timeline", file: "timeline.json", status: "ok" },
        { label: "future-view", file: "future-view.json", status: "ok" },
      ],
    },
  };
  const { sessions } = resolveSessions({ ...input, sessionsSpec: null, autoCount: 0 });
  const text = snapshotLines(snapshot, sessions).join("\n");
  expect(text).toContain("| `r-scan.json` | ok | diagnostic_follow_through |");
  expect(text).toContain("| `builder.json` | ok | diagnostic_follow_through |");
  expect(text).toContain("| `review-yield.json` | ok | diagnostic_follow_through |");
  expect(text).toContain("| `timeline.json` | ok | category_and_hook_yield |");
  expect(text).toContain("| `future-view.json` | ok | primary |");
  expect(snapshotLines(snapshot, []).filter((line: string) => line.endsWith("| primary |")).length).toBe(5);
});
