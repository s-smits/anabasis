// The alerts over the live runs: the fold from one look's rows to its lines, and the verb over real logs.
import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "../src/meta/filesystem.ts";
import { type AlertState, alertsOf, type HostRows, type Row } from "../tools/runs/alerts.ts";

const folders: string[] = [];
afterAll(() => {
  for (const root of folders) rmSync(root, { recursive: true, force: true });
});

/** A row, whose endings are by default the one its state stands on. */
const row = (more: Partial<Row> = {}): Row => {
  const state = more.state ?? { kind: "live", kept: true };
  const ending = "ending" in state ? state.ending : undefined;
  return {
    name: "r",
    promotions: [],
    state,
    owed: true,
    lastAt: "2026-11-06T10:00:00.000Z",
    kept: [],
    paused: false,
    endings: ending === undefined ? [] : [ending],
    ...more,
  };
};
const heldAs = (rows: readonly Row[], more: readonly string[] = []): HostRows => ({
  rows,
  held: [...rows.map(({ name }) => name), ...more],
  retired: [],
});
const here = (...rows: Row[]) => [{ host: "here", said: heldAs(rows) }];
const unread = (digest: string) => ({ digest, read: null });
const read = (digest: string, session: string, confirmed = true) => ({
  digest,
  read: {
    session,
    tally: { wins: 6, losses: 0, ties: 2 },
    confirmed,
  },
});
/** What a look at `rows` remembers, whatever it printed. */
const lookedAt = (...rows: Row[]): AlertState => alertsOf(null, here(...rows)).next;

describe("the fold of one look", () => {
  it("says a run is ready to pause, with the command, once a second promotion is read and only then", () => {
    const unconfirmed = row({ promotions: [read("aaaa", "g-1"), unread("bbbb")] });
    const waiting = alertsOf(lookedAt(row({ promotions: [read("aaaa", "g-1")] })), here(unconfirmed));
    expect(waiting.lines.join("\n")).not.toContain("ready to pause");
    const both = row({ promotions: [read("aaaa", "g-1"), read("bbbb", "g-2")] });
    const ready = alertsOf(waiting.next, here(both));
    expect(ready.lines).toHaveLength(2);
    expect(ready.lines[1]).toContain("ready to pause");
    expect(ready.lines[1]).toEndWith("bun run runs pause r --yes");
    const third = row({ promotions: [...both.promotions, read("cccc", "g-3")] });
    expect(alertsOf(ready.next, here(third)).lines.join("\n")).not.toContain("ready to pause");
  });

  it("reads no second promotion as ready where its first was never read against the starter", () => {
    const { lines } = alertsOf(
      lookedAt(row({ promotions: [unread("aaaa")] })),
      here(row({ promotions: [unread("aaaa"), read("bbbb", "g-2")] })),
    );
    expect(lines.join("\n")).not.toContain("ready to pause");
  });
});
