import { ExamSide } from "../components/exam-side.tsx";
import { Badge } from "../components/primitives.tsx";
import { RecordView } from "../components/record.tsx";
import { type Of, useEvent, useHarness, useHarnessDiff, useHarnessFile } from "../live.ts";
import { useMemo } from "react";
import type { CampaignReading, HarnessDiff, HarnessFile, Tier } from "../models.ts";
import type { Navigation } from "../route.ts";
import { AnswerIssues, harnessLabel } from "./drill.tsx";
import { FileInspector } from "./file-inspector.tsx";
import { bytes, time } from "./format.ts";
import { useHeld } from "./held.ts";
import { useLate } from "./late.ts";
import { plural } from "../../../../src/meta/text.ts";

/*
 * What the inspector on the right holds, as the route names it (`route.ts`): a file of a kept
 * harness (`harness` and `file`), the diff of two harnesses (`diff` to `harness`), or one
 * raw event (`event`). The Campaign pane opens the first two, the Moves pane a session's harness,
 * and the Log pane the third.
 *
 * Each is read here, and only while the route names it: the diff per file, and the event only on
 * a server in the exam tier, since in the default tier it is refused and its place is the exam
 * side's quiet line, never an error (the brief of 11 October, section 8). An answer to the previous
 * file or diff is no answer to the one named now: it stays, under its own head and closed to the
 * pointer, until the next is read, and a read slower than a moment says so (`held.ts`); an answer to
 * the previous event is shown as loading. The issues an answer carries, a harness folder missing or
 * refused, a path refused, are shown with it.
 */

/** One line of a unified diff, numbered on the side or sides it stands on. */
interface DiffLine {
  readonly kind: "hunk" | "add" | "remove" | "same" | "note";
  readonly old: number | null;
  readonly fresh: number | null;
  readonly text: string;
}

/** A harness file or a diff as the inspector shows it: its head, and the answer it was read from. */
type Shown = {
  readonly path: string;
  readonly digest: string;
} & (
  | { readonly kind: "file"; readonly file: string; readonly answer: HarnessFile }
  | { readonly kind: "diff"; readonly answer: HarnessDiff }
);

const LABELS = { file: "Harness file", diff: "Harness diff" } as const;

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;
const SIGNS = { hunk: "", add: "+", remove: "−", same: "", note: "" } as const;
const CHANGE_TONES = { added: "good", removed: "bad", changed: "neutral" } as const;

/** A unified diff's lines from its first hunk on, the file headers before it left out. */
function diffLines(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let [old, fresh] = [0, 0];
  let started = false;
  for (const line of diff.split("\n")) {
    const hunk = HUNK.exec(line);
    if (hunk !== null) {
      started = true;
      [old, fresh] = [Number(hunk[1]), Number(hunk[2])];
      lines.push({ kind: "hunk", old: null, fresh: null, text: line });
      continue;
    }
    if (!started || line === "") continue;
    if (line.startsWith("+")) {
      lines.push({ kind: "add", old: null, fresh, text: line.slice(1) });
      fresh += 1;
    } else if (line.startsWith("-")) {
      lines.push({ kind: "remove", old, fresh: null, text: line.slice(1) });
      old += 1;
    } else if (line.startsWith("\\")) {
      lines.push({ kind: "note", old: null, fresh: null, text: line.slice(1).trim() });
    } else {
      lines.push({ kind: "same", old, fresh, text: line.slice(1) });
      [old, fresh] = [old + 1, fresh + 1];
    }
  }
  return lines;
}

/** A harness's files, each a link that opens it in the inspector, and what the server could
 *  not read of them. Another harness's list stays, closed to the pointer, while this one's is read
 *  (`held.ts`). */
export function HarnessFiles({
  of,
  digest,
  current,
  navigation,
}: {
  of: Of;
  digest: string;
  current: string | null;
  navigation: Navigation;
}) {
  const files = useHarness(of, digest);
  const { view, stale, slow } = useHeld(digest, files.current ? files.data : null);
  if (files.error !== null && !files.current) return <p className="ana-faint">{files.error}</p>;
  return (
    <div aria-busy={stale} inert={stale}>
      {slow ? <p className="ana-faint">Reading the harness's files.</p> : null}
      {view === null ? null : <AnswerIssues answer={view} />}
      {view === null ? null : (
        <ul className="ana-file-links">
          {view.files.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                className={`ana-evidence-link ${file.path === current ? "is-current" : ""}`}
                aria-current={file.path === current ? "true" : undefined}
                onClick={() => navigation.push({ harness: digest, file: file.path, diff: null, event: null })}
              >
                {file.path}
              </button>
              <small>{bytes(file.bytes)}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Two harnesses' files compared, one unified diff a changed file, each line signed as well as
 *  tinted so that an addition and a removal read apart without colour. */
function DiffView({ diff }: { diff: HarnessDiff }) {
  return (
    <div className="ana-diff">
      <p className="ana-faint">{plural(diff.files.length, "file")} changed.</p>
      <AnswerIssues answer={diff} />
      {diff.files.length === 0 ? (
        <p className="ana-exam-side">The two harnesses' agent files are the same.</p>
      ) : null}
      {diff.files.map((file) => {
        // A file the server could not diff in its bound has no lines, and its issue says why.
        const lines = file.diff === null ? [] : diffLines(file.diff);
        const added = lines.filter((line) => line.kind === "add").length;
        const removed = lines.filter((line) => line.kind === "remove").length;
        return (
          <section key={file.path} className="ana-diff-file" aria-label={`${file.path}, ${file.change}`}>
            <header>
              <code>{file.path}</code>
              <Badge tone={CHANGE_TONES[file.change]}>{file.change}</Badge>
              <span className="ana-num">
                {file.diff === null ? (
                  "not diffed"
                ) : (
                  <>
                    +{added} −{removed}
                  </>
                )}
              </span>
            </header>
            <table className="ana-diff-lines">
              <tbody>
                {lines.map((line, at) => (
                  <tr key={`${String(at)}:${line.kind}`} className={`is-${line.kind}`}>
                    <td className="ana-diff-no">{line.old ?? ""}</td>
                    <td className="ana-diff-no">{line.fresh ?? ""}</td>
                    <td className="ana-diff-sign" aria-label={line.kind === "same" ? undefined : line.kind}>
                      {SIGNS[line.kind]}
                    </td>
                    <td className="ana-diff-text">{line.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

/** One raw event. A page in the default tier knows the server refuses it, and does not ask. */
function EventBody({ campaign, index, tier }: { campaign: string; index: number; tier: Tier }) {
  const live = useEvent(campaign, tier === "exam" ? index : null);
  // The event before stays while the next is read, and a read is said only once it is late.
  const late = useLate(tier === "exam" ? live : null);
  if (tier === "default" || live.refused === "exam-side") return <ExamSide what="a raw event's payload" />;
  if (live.data === null || live.error !== null) {
    return <p className="ana-faint">{live.error ?? (late ? "Reading the event." : "")}</p>;
  }
  return (
    <>
      {late ? <p className="ana-faint">Reading the event.</p> : null}
      <div className="ana-record-meta">
        <span>{live.data.kind}</span>
        <time>{time(live.data.at)}</time>
      </div>
      <AnswerIssues answer={live.data} />
      <RecordView key={live.key} value={live.data.data} defaultExpanded="all" />
    </>
  );
}

/** A file's answer as the inspector's payload, or null for a refused path, which is answered with no
 *  value and an issue that says why: the issue, not an empty file. */
function payloadOf(answer: HarnessFile) {
  return answer.value === null && answer.issues.length > 0
    ? null
    : { content: answer.content, value: answer.value, truncated: answer.truncated, bytes: answer.bytes };
}

/** The file or the diff the route names, read; `named` is its head, and `ready` its view once the
 *  answer to it is in. */
function useNamed(of: Of, reading: CampaignReading | null, route: Navigation["route"]) {
  const digest = route.harness;
  const harness = harnessLabel(reading, digest);
  const path = digest === null ? null : route.file;
  const from = digest === null || path !== null ? null : route.diff;
  const file = useHarnessFile(of, digest, path);
  const diff = useHarnessDiff(of, from, digest);
  let named: { readonly kind: Shown["kind"]; readonly path: string; readonly error: string | null } | null =
    null;
  if (path !== null) {
    named = { kind: "file", path: `${harness} / ${path}`, error: file.error };
  } else if (from !== null) {
    named = { kind: "diff", path: `${harnessLabel(reading, from)} to ${harness}`, error: diff.error };
  }
  const head = named?.path ?? null;
  const ready = useMemo((): Shown | null => {
    if (digest === null || head === null) return null;
    if (path !== null) {
      return file.current && file.data !== null
        ? { kind: "file", path: head, digest, file: path, answer: file.data }
        : null;
    }
    return diff.current && diff.data !== null
      ? { kind: "diff", path: head, digest, answer: diff.data }
      : null;
  }, [digest, head, path, file.current, file.data, diff.current, diff.data]);
  return { named, ready };
}

/** The inspector the route opens, or nothing while it names none. A file or a diff that is open
 *  stays, its head with it, while the next the route names is read (`held.ts`), so that opening one
 *  file after another, or a diff after a file, paints no empty inspector between them. */
export function Inspector({
  navigation,
  reading,
}: {
  navigation: Navigation;
  reading: CampaignReading | null;
}) {
  const { route } = navigation;
  const close = () => navigation.push({ file: null, diff: null, event: null });
  const campaign = reading?.row.key ?? null;
  const of: Of = { key: campaign, since: reading?.row.lastEventAt ?? null };
  const { named, ready } = useNamed(of, reading, route);
  const { view, stale, slow } = useHeld(named === null ? null : `${named.kind} ${named.path}`, ready);
  if (named !== null && route.harness !== null) {
    const shown = view;
    // The files beside a file are the shown file's harness's, or the named one's before any is shown.
    const listing = shown ?? { ...named, digest: route.harness };
    const listed = listing.kind === "file" ? listing.digest : null;
    return (
      <FileInspector
        label={LABELS[shown?.kind ?? named.kind]}
        path={shown?.path ?? named.path}
        payload={shown?.kind === "file" ? payloadOf(shown.answer) : null}
        loading={ready === null}
        error={named.error}
        onClose={close}
      >
        {slow ? <p className="ana-faint">Reading {named.path}.</p> : null}
        <div aria-busy={stale} inert={stale}>
          {shown === null ? null : shown.kind === "file" ? (
            <AnswerIssues answer={shown.answer} />
          ) : (
            <DiffView diff={shown.answer} />
          )}
        </div>
        {campaign === null || listed === null ? null : (
          <HarnessFiles
            of={of}
            digest={listed}
            current={shown?.kind === "file" ? shown.file : route.file}
            navigation={navigation}
          />
        )}
      </FileInspector>
    );
  }
  if (route.event === null) return null;
  return (
    <FileInspector
      label="Event"
      path={`#${String(route.event)}`}
      payload={null}
      loading={false}
      error={null}
      onClose={close}
    >
      {campaign === null ? null : (
        <EventBody campaign={campaign} index={route.event} tier={reading?.tier ?? "default"} />
      )}
    </FileInspector>
  );
}
