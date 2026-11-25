/**
 * The triggers of how a run was conducted rather than what it measured: endings the campaign went on
 * from and the operator's words, the Builder's conversation across compactions, the drafted exam,
 * the launches, whether the log reads in order, and the Referee's refused evidence.
 */
import { ANSWERED, PAUSE, pendingWords } from "#src/campaign/word.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import type { Receipt } from "../runs/receipt.ts";
import { fired, emitIf, type Index, share, tally, text, type Trigger } from "./folds.ts";

/** Endings the campaign went on from, and the operator's words with how many an event acted on,
 *  read as the host reads them (`pendingWords`). */
function moveTriggers(log: Index): Trigger[] {
  const last = log.events.length - 1;
  const endings = log.events.flatMap(({ kind, data }, index) =>
    kind === "campaign.ended" && index < last ? [`${text(data.ending)} at event ${String(index)}`] : [],
  );
  const words = log.events.filter(({ kind }) => kind === "campaign.word");
  const said = ({ data }: LogEvent): string =>
    data.word === PAUSE && isString(data.why) ? `${PAUSE} (${data.why})` : text(data.word);
  // A pause is answered by its time, not by a move (`paused`), so only the other words are owed one.
  const owed = words.filter(({ data }) => ANSWERED.some((each) => each === data.word)).length;
  return [
    ...emitIf(endings.length > 0, "ENDED AND WENT ON", endings.join("; ")),
    ...emitIf(
      words.length > 0,
      "OPERATOR WORDS",
      `${tally(countBy(words, said))}; of the words a move answers, ${share(owed - pendingWords(log.events).length, owed)} acted on`,
    ),
  ];
}

/** Each Builder session's compactions beside its turns and its `read_opening` calls. */
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
  return emitIf(lines.length > 0, "BUILDER COMPACTED", lines.join("; "));
}

/** The drafts an exam took, how each drafting session ended, and the measurement it recorded. */
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

/** The launches beside the log, where there is more than one, more than one commit, a dirty tree,
 *  or a campaign command that left no receipt; with the solver's Python by version and packages,
 *  since a host's pin can move both between two launches at one commit. */
function launchTriggers(log: Index, launches: readonly Receipt[]): Trigger[] {
  if (launches.length === 0) {
    return emitIf(
      log.of("campaign.opened").length > 0,
      "NO LAUNCH RECEIPT",
      "a campaign command opened this log and no receipt lies beside it",
    );
  }
  const commits = new Set(launches.map((launch) => launch.commit.slice(0, 8)));
  const dirty = launches.filter((launch) => launch.dirty).length;
  const logins = new Set(launches.map((launch) => launch.login ?? "unnamed"));
  const buns = new Set(launches.map((launch) => launch.bun ?? "unrecorded"));
  const pythons = new Set(
    launches.flatMap(({ python }) => python ?? []).map((python) => JSON.stringify(python)),
  );
  return emitIf(
    launches.length > 1 || dirty > 0,
    "LAUNCHES",
    `${String(launches.length)} launch${launches.length === 1 ? "" : "es"} at ${plural(commits.size, "commit")} (${[...commits].join(", ")}), ${String(dirty)} from a dirty tree, under ${plural(logins.size, "login")}, ${plural(buns.size, "Bun version")} and ${plural(pythons.size, "recorded Python")} for the solver`,
  );
}

/** What an append-only log of one writer cannot hold: a clock that runs backwards, a solve that
 *  finished without starting, a comparison started twice under one id. */
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
  return emitIf(said.length > 0, "LOG OUT OF ORDER", said.join("; "));
}

function refusalTriggers(log: Index): Trigger[] {
  const refused = log.of("referee.refused");
  return emitIf(
    refused.length > 0,
    "RULINGS REFUSED",
    tally(countBy(refused, (data) => text(asRecord(data.asked)?.ruling))),
  );
}

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
