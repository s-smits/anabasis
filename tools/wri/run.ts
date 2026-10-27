/**
 * The triggers of the lanes that read how a run was conducted rather than what it measured: the
 * moves the campaign command made against its table (lane 28), the Builder's conversation across
 * its compactions (lane 20), the exam a campaign drafted from its prompt (lane 8), the launches
 * that ran it (lane 32), and whether its log reads in order (lane 33). Lane 7's count of the
 * Referee's refused evidence sits here too, since `read.ts` stands near the size policy's ceiling.
 *
 * Added on 27 October, when every pull request was given an area label (`references/lanes.md`,
 * "Labels") and six of the thirteen labels had no lane: a prediction about the campaign command, a
 * launch or the log could be written and never read back from a report. Every measured run opens
 * from a prompt and is led by a Builder's conversation (`AGENTS.md`, sections 4 and 10), and until
 * then no lane read either.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import type { Receipt } from "../runs/receipt.ts";
import { fired, type Index, share, tally, text, type Trigger } from "./folds.ts";

/** Lane 28: moves the Builder made where the table named another, endings the campaign went on
 *  from, and the operator's words with how many an event acted on. */
function moveTriggers(log: Index): Trigger[] {
  const moves = log.of("campaign.move");
  const asked = moves.filter((data) => data.code === "asked");
  const last = log.events.length - 1;
  const endings = log.events.flatMap(({ kind, data }, index) =>
    kind === "campaign.ended" && index < last ? [`${text(data.ending)} at event ${String(index)}`] : [],
  );
  const heard = new Set(log.events.flatMap(({ data }) => (Array.isArray(data.answers) ? data.answers : [])));
  const words = log.events.flatMap(({ kind, data }, index) =>
    kind === "campaign.word" ? [{ data, index }] : [],
  );
  return [
    ...(asked.length > 0
      ? [
          fired(
            "MOVES ASKED",
            `${share(asked.length, moves.length)} moves the Builder asked for where the table named another: ${tally(countBy(asked, (data) => text(data.move)))}`,
          ),
        ]
      : []),
    ...(endings.length > 0 ? [fired("ENDED AND WENT ON", endings.join("; "))] : []),
    ...(words.length > 0
      ? [
          fired(
            "OPERATOR WORDS",
            `${tally(countBy(words, ({ data }) => text(data.word)))}; ${share(words.filter(({ index }) => heard.has(index)).length, words.length)} acted on`,
          ),
        ]
      : []),
  ];
}

/** Lane 20: each Builder session's compactions beside its turns and its calls of `read_opening`. */
function conversationTriggers(log: Index): Trigger[] {
  const per = (kind: LogEvent["kind"]) => countBy(log.of(kind), (data) => text(data.session));
  const [compacted, turns] = [per("build.compacted"), per("build.turn")];
  const lines = log.builds.flatMap(({ session, calls }) => {
    const times = compacted[session] ?? 0;
    const opened = calls.filter((call) => call.tool === "read_opening").length;
    return times === 0
      ? []
      : [
          `${session}: ${plural(times, "compaction")} in ${plural(turns[session] ?? 0, "turn")}, read_opening ${String(opened)}`,
        ];
  });
  return lines.length > 0 ? [fired("BUILDER COMPACTED", lines.join("; "))] : [];
}

/** Lane 8: the drafts an exam took, how each drafting session ended, and the measurement it
 *  recorded. */
function draftTriggers(log: Index): Trigger[] {
  const drafted = log.of("exam.drafted");
  if (drafted.length === 0) return [];
  const sessions = log.of("draft.finished").map((data) => {
    const measured = asRecord(data.measurement)?.status;
    return `${text(data.session)} ${text(data.ended)} after ${plural(isNumber(data.tries) ? data.tries : 0, "attempt")}${isString(measured) ? `, measurement ${measured}` : ""}`;
  });
  return [
    fired(
      "EXAM DRAFTED",
      `${plural(drafted.length, "draft")} recorded; ${sessions.join("; ") || "no drafting session ended"}`,
    ),
  ];
}

/** Lane 32: the launches beside the log, where there is more than one, more than one commit, a
 *  dirty tree, or a campaign command that left no receipt. */
function launchTriggers(log: Index, launches: readonly Receipt[]): Trigger[] {
  if (launches.length === 0) {
    return log.of("campaign.opened").length > 0
      ? [fired("NO LAUNCH RECEIPT", "a campaign command opened this log and no receipt lies beside it")]
      : [];
  }
  const commits = new Set(launches.map((launch) => launch.commit.slice(0, 8)));
  const dirty = launches.filter((launch) => launch.dirty).length;
  const logins = new Set(launches.map((launch) => launch.login ?? "unnamed"));
  const buns = new Set(launches.map((launch) => launch.bun ?? "unrecorded"));
  return launches.length > 1 || dirty > 0
    ? [
        fired(
          "LAUNCHES",
          `${String(launches.length)} launch${launches.length === 1 ? "" : "es"} at ${plural(commits.size, "commit")} (${[...commits].join(", ")}), ${String(dirty)} from a dirty tree, under ${plural(logins.size, "login")} and ${plural(buns.size, "Bun version")}`,
        ),
      ]
    : [];
}

/** Lane 33: what an append-only log of one writer cannot hold: a clock that runs backwards, a solve
 *  that finished without starting, a comparison started twice under one id. */
function orderTriggers(log: Index): Trigger[] {
  const backwards = log.events.filter(
    (event, index) => index > 0 && event.at < (log.events[index - 1]?.at ?? ""),
  );
  const started = new Set(log.of("solve.started").map((data) => text(data.solve)));
  const orphans = log.of("solve.finished").filter((data) => !started.has(text(data.solve)));
  const twice = Object.entries(countBy(log.of("comparison.started"), (data) => text(data.session))).filter(
    ([, times]) => times > 1,
  );
  const said = [
    ...(backwards.length > 0 ? [`${plural(backwards.length, "event")} stamped before the one above it`] : []),
    ...(orphans.length > 0 ? [`${plural(orphans.length, "solve")} finished with no start`] : []),
    ...(twice.length > 0 ? [`comparison started twice: ${twice.map(([id]) => id).join(", ")}`] : []),
  ];
  return said.length > 0 ? [fired("LOG OUT OF ORDER", said.join("; "))] : [];
}

/** Lane 7: the rulings the host refused for want of their evidence, by the ruling asked for. */
function refusalTriggers(log: Index): Trigger[] {
  const refused = log.of("referee.refused");
  return refused.length > 0
    ? [fired("RULINGS REFUSED", tally(countBy(refused, (data) => text(asRecord(data.asked)?.ruling))))]
    : [];
}

/** Every trigger of this module, in lane order. */
export function runTriggers(log: Index, launches: readonly Receipt[]): Trigger[] {
  return [
    ...refusalTriggers(log),
    ...moveTriggers(log),
    ...conversationTriggers(log),
    ...draftTriggers(log),
    ...launchTriggers(log, launches),
    ...orderTriggers(log),
  ];
}
