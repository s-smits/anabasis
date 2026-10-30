import type { ToolCall } from "../models.ts";
import { Badge } from "./primitives.tsx";
import { asRecord, isString, type JsonValue } from "../../../../src/meta/json-shape.ts";

/*
 * One tool call of a solve or a session, as v1's task view drew it (`views/cases.tsx` at 5bc9988):
 * labelled by its number and its tool, opened in place to its arguments and its result. Two panes
 * draw calls, a session's in Moves and a solve's trace in Moves and Tasks, so the component is
 * theirs to share. The closed row also carries the first line of what the call was given, cut to
 * the row: reading the first ten commands of Builder session b-4 took ten clicks on 30 October,
 * one a call. Its turn is the heading the call stands under, so the row does not repeat it.
 */

/** A call's arguments as a reader wants them: a shell command as it was typed, else the JSON. */
function shownArguments(args: JsonValue): string {
  const command = asRecord(args)?.command;
  return isString(command) ? command : JSON.stringify(args, null, 2);
}

/** What a closed row shows of a call: its command's first line, else its first text argument. */
function glimpseOf(args: JsonValue | null): string | null {
  const record = args === null ? undefined : asRecord(args);
  const first = isString(record?.command) ? record.command : Object.values(record ?? {}).find(isString);
  return first?.trim().split("\n")[0] ?? null;
}

export function ToolCallDetail({ call }: { call: ToolCall }) {
  const glimpse = glimpseOf(call.args);
  return (
    <li>
      <details className="ana-tool-call">
        <summary>
          <span>{call.seq}</span>
          <strong>{call.tool}</strong>
          <code className="ana-tool-glimpse">{glimpse}</code>
          {call.ms === null ? null : <small>{Math.round(call.ms)} ms</small>}
          {call.isError ? <Badge tone="bad">error</Badge> : null}
          <span className="ana-caret" aria-hidden>
            ›
          </span>
        </summary>
        <div className="ana-tool-content">
          <h4>{call.tool === "bash" ? "Command" : "Arguments"}</h4>
          {call.args === null ? <p>Arguments not recorded</p> : <pre>{shownArguments(call.args)}</pre>}
          <h4>Result</h4>
          {call.result === null ? <p>Result not recorded</p> : <pre>{call.result}</pre>}
          {call.truncated ? <p className="ana-note">The result is cut; the whole call is its event</p> : null}
        </div>
      </details>
    </li>
  );
}

/** Whether every term of `query` is in `text`, case aside: the search of a filter row. */
export function matchesTerms(text: string, query: string): boolean {
  const content = text.toLowerCase();
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/u)
    .every((term) => content.includes(term));
}
