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
  it("surfaces a decision prompt on each fully read promotion 1..4 and a ceiling pause at 5", () => {
    const p1Unread = row({ promotions: [unread("aaaa")] });
    expect(alertsOf(lookedAt(row()), here(p1Unread)).lines.join("\n")).not.toContain("ready to pause");

    const p1Read = row({ promotions: [read("aaaa", "g-1")] });
    const after1 = alertsOf(lookedAt(p1Unread), here(p1Read));
    expect(after1.lines).toHaveLength(2);
    expect(after1.lines[1]).toContain("ready to pause or continue, 1 promotion checked");
    expect(after1.lines[1]).toEndWith("bun run runs pause r --yes");

    const p2Unread = row({ promotions: [read("aaaa", "g-1"), unread("bbbb")] });
    const waiting = alertsOf(after1.next, here(p2Unread));
    expect(waiting.lines.join("\n")).not.toContain("ready to pause");

    const p2Read = row({ promotions: [read("aaaa", "g-1"), read("bbbb", "g-2")] });
    const after2 = alertsOf(waiting.next, here(p2Read));
    expect(after2.lines).toHaveLength(2);
    expect(after2.lines[1]).toContain("ready to pause or continue, 2 promotions checked");
    expect(after2.lines[1]).toEndWith("bun run runs pause r --yes");

    const p3Read = row({ promotions: [...p2Read.promotions, read("cccc", "g-3")] });
    const after3 = alertsOf(after2.next, here(p3Read));
    expect(after3.lines.at(-1)).toContain("ready to pause or continue, 3 promotions checked");

    const p4Read = row({ promotions: [...p3Read.promotions, read("dddd", "g-4")] });
    const after4 = alertsOf(after3.next, here(p4Read));
    expect(after4.lines.at(-1)).toContain("ready to pause or continue, 4 promotions checked");

    const p5Read = row({ promotions: [...p4Read.promotions, read("eeee", "g-5")] });
    const after5 = alertsOf(after4.next, here(p5Read));
    expect(after5.lines.at(-1)).toContain("ready to pause, 5 promotions checked (ceiling reached)");
    expect(after5.lines.at(-1)).toEndWith("bun run runs pause r --yes");

    // Re-running with no new starter read does not repeat the prompt.
    expect(alertsOf(after5.next, here(p5Read)).lines).toEqual([]);
  });

  it("reads no promotion as ready where an earlier promotion was never read against the starter", () => {
    const { lines } = alertsOf(
      lookedAt(row({ promotions: [unread("aaaa")] })),
      here(row({ promotions: [unread("aaaa"), read("bbbb", "g-2")] })),
    );
    expect(lines.join("\n")).not.toContain("ready to pause");
  });
});
