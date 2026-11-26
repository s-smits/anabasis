import type { ToolCall } from "../models.ts";
import { Badge } from "./primitives.tsx";
import { asRecord, isString, type JsonValue } from "../../../../src/meta/json-shape.ts";

// One tool call, numbered and named by its tool, opened in place to its arguments and result; Moves and
// Tasks share it. The closed row carries the first line of what the call was given, so a session's
// first commands take no click each.

/** A call's arguments as a reader wants them: a shell command as it was typed, else the JSON. */
function shownArguments(args: JsonValue): string {
  const command = asRecord(args)?.command;
  return isString(command) ? command : JSON.stringify(args, null, 2);
}

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

export function matchesTerms(text: string, query: string): boolean {
  const content = text.toLowerCase();
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/u)
    .every((term) => content.includes(term));
}
