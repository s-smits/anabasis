// The names people read for a campaign's harnesses (`src/campaign/names.ts`): the Starter A by role,
// the rest a letter each in the order the log first names them, kept whatever is appended after.

import { describe, expect, it } from "bun:test";
import { namesOf } from "../src/campaign/names.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

const at = "2026-10-14T00:00:00.000Z";
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at, kind, data });
const digest = (fill: string) => fill.repeat(64);
const [starter, first, second, third] = [digest("a"), digest("b"), digest("c"), digest("d")];

/** A session from `parent` that left `version`, then its comparison against `old`. */
const round = (id: string, parent: string, version: string, old: string): LogEvent[] => [
  event("build.started", { session: id, parent }),
  event("harness.version", { session: id, parent, version }),
  event("build.finished", { session: id, harness: version }),
  event("comparison.started", { session: `${id}-c`, starter, old, fresh: version }),
];

describe("harness names", () => {
  it("keeps each letter whatever is appended after, a harness named again and a promotion among it", () => {
    const log = [...round("b-1", starter, first, starter), ...round("b-2", first, second, starter)];
    const before = namesOf(log);
    const after = namesOf([
      ...log,
      event("harness.promoted", { harness: second, from: starter }),
      ...round("b-3", second, third, second),
      event("comparison.started", { session: "g-1", starter, old: second, fresh: first }),
    ]);
    expect([starter, first, second].map((each) => before.get(each))).toEqual(["A", "B", "C"]);
    expect([starter, first, second, third].map((each) => after.get(each))).toEqual(["A", "B", "C", "D"]);
  });
});
