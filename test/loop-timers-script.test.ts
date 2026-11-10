// The loop's timers are judged by what their firings did, read from the session's transcript: a
// firing's own row said whether it was useful in 68 of 389 ledger rows and when it should have fired
// in none. Each case is a transcript in the shape Claude Code writes, cut to the fields the reader takes.
import { describe, expect, it } from "bun:test";
import { timerLines, timersIn } from "#skills/run-improvement-campaign/scripts/timers.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";

let count = 0;
const line = (type: "user" | "assistant", content: JsonValue, more: JsonObject = {}) => {
  count += 1;
  return JSON.stringify({
    uuid: `u${String(count)}`,
    type,
    timestamp: "2026-11-09T12:00:00.000Z",
    message: { content },
    ...more,
  });
};
const create = (call: string, id: string, cron: string, recurring: boolean) => [
  line("assistant", [
    { type: "tool_use", id: call, name: "CronCreate", input: { cron, prompt: `watch ${id}` } },
  ]),
  line("user", [
    {
      type: "tool_result",
      tool_use_id: call,
      content: `Scheduled ${recurring ? "recurring job" : "one-shot task"} ${id} (${cron}).`,
    },
  ]),
];
const fired = (id: string) => line("user", "the timer's prompt", { scheduledTaskId: id });
const bash = (command: string) =>
  line("assistant", [{ type: "tool_use", id: "t", name: "Bash", input: { command } }]);
const says = (text: string) => line("assistant", [{ type: "text", text }]);
const result = () => line("user", [{ type: "tool_result", tool_use_id: "t", content: "ok" }]);

describe("what a session's timers did", () => {
  const transcript = [
    ...create("c1", "aaaaaaaa", "13 * * * *", true),
    ...create("c2", "bbbbbbbb", "7 12 10 11 *", false),
    ...create("c3", "cccccccc", "17 */4 * * *", true),
    // A look that found nothing: one read-only command and a line.
    fired("aaaaaaaa"),
    bash("bun run runs status | head -3"),
    result(),
    says("Nothing due."),
    // A look that only reported, at length, is neither a change nor quiet.
    fired("aaaaaaaa"),
    bash("bun run runs usage"),
    result(),
    says("x".repeat(500)),
    // A firing that launched a run changed something, however little it then said.
    fired("aaaaaaaa"),
    bash("bun run runs fresh job --yes"),
    result(),
    says("Launched."),
    line("user", "the operator writes", { turnOrigin: "human" }),
    // Work after the operator's line belongs to no firing.
    line("assistant", [{ type: "tool_use", id: "e", name: "Edit", input: { file_path: "/x" } }]),
    fired("bbbbbbbb"),
    line("assistant", [{ type: "tool_use", id: "w", name: "Write", input: { file_path: "/cycle.md" } }]),
  ];

  it("counts each timer's firings by whether the turn changed anything or ended in a line", () => {
    const [hourly, once, never] = timersIn([transcript]);
    expect(hourly).toMatchObject({ id: "aaaaaaaa", cron: "13 * * * *", recurring: true });
    expect(hourly).toMatchObject({ firings: 3, changed: 1, quiet: 1 });
    expect(once).toMatchObject({ id: "bbbbbbbb", recurring: false, firings: 1, changed: 1, quiet: 0 });
    expect(never).toMatchObject({ id: "cccccccc", firings: 0 });
  });

  it("counts a line once where a copied session repeats it, and nothing from before the time asked for", () => {
    expect(timersIn([transcript, transcript])[0]).toMatchObject({ firings: 3 });
    expect(timersIn([transcript], "2026-11-10")).toEqual([]);
  });

  it("keeps the kind of a timer made before the time asked for, read with its offset", () => {
    const later = line("user", "the timer's prompt", {
      scheduledTaskId: "dddddddd",
      timestamp: "2026-11-09T13:00:00.000Z",
    });
    // 13:30 at +01:00 is 12:30Z: after the creation at 12:00Z and before the firing at 13:00Z.
    const [made] = timersIn(
      [[...create("c4", "dddddddd", "0 */2 * * *", true), later]],
      "2026-11-09T13:30+01:00",
    );
    expect(made).toMatchObject({ id: "dddddddd", recurring: true, cron: "0 */2 * * *", firings: 1 });
  });

  it("reads a timer whose creation is absent as of unknown kind, in neither total", () => {
    const lines = timerLines(timersIn([[fired("eeeeeeee"), says("Nothing due.")]]));
    expect(lines[0]?.split(" · ").slice(0, 3)).toEqual(["eeeeeeee", "?", "unknown"]);
    expect(lines.slice(1).map((each) => /(\d+) firing/u.exec(each)?.[1])).toEqual(["0", "0"]);
  });

  it("ends a firing at the end of its file, so the next file's work is not credited to it", () => {
    const first = [...create("c5", "ffffffff", "5 * * * *", true), fired("ffffffff"), says("Nothing due.")];
    const second = [
      line("assistant", [{ type: "tool_use", id: "x", name: "Edit", input: { file_path: "/y" } }]),
    ];
    expect(timersIn([first, second])[0]).toMatchObject({ firings: 1, changed: 0, quiet: 1 });
  });

  it("reads an append to a file as a change and an append of errors as none", () => {
    const firing = (command: string) =>
      timersIn([[...create("c6", "abababab", "9 * * * *", true), fired("abababab"), bash(command)]])[0];
    expect(firing("echo row >> cycle.md")).toMatchObject({ changed: 1 });
    expect(firing("bun run runs status 2>> /tmp/err")).toMatchObject({ changed: 0 });
  });

  it("prints the timers that fired, the busiest first, and the totals with their shares", () => {
    expect(timerLines(timersIn([transcript]))).toEqual([
      "aaaaaaaa · 13 * * * * · recurring · 3 fired, 1 changed, 1 quiet · watch aaaaaaaa",
      "bbbbbbbb · 7 12 10 11 * · once · 1 fired, 1 changed, 0 quiet · watch bbbbbbbb",
      "recurring: 2 timer(s), 1 never fired · 3 firing(s), 1 changed (33%), 1 quiet (33%)",
      "one-shot: 1 timer(s), 0 never fired · 1 firing(s), 1 changed (100%), 0 quiet (0%)",
    ]);
  });
});
