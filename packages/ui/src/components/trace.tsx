import { useState } from "react";
import type { ToolCall, Turn } from "../models.ts";
import { money } from "../views/format.ts";
import { Badge, Button } from "./primitives.tsx";
import { ToolCallDetail } from "./tool-call.tsx";

/*
 * A trace as a reader follows it: each model turn with what it said, and under it the calls it
 * made, opened one at a time (`ToolCallDetail`). A Builder session on record ran 116 turns, so a
 * long trace shows its first turns and the rest on request, and a long turn its first lines.
 */

/** Turns shown before the rest are asked for. */
const FIRST_TURNS = 40;
/** Characters of a turn's text shown before the rest are asked for. */
const FIRST_CHARACTERS = 480;

/** One turn's text, cut where it is long. */
function TurnText({ text }: { text: string }) {
  const [whole, setWhole] = useState(false);
  // A turn that only called tools says so by its calls, under it.
  if (text.trim() === "") return null;
  const long = text.length > FIRST_CHARACTERS;
  return (
    <div className="ana-turn-text">
      <p>{long && !whole ? `${text.slice(0, FIRST_CHARACTERS)}…` : text}</p>
      {long ? (
        <button type="button" className="ana-evidence-link" onClick={() => setWhole((value) => !value)}>
          {whole ? "Show less" : "Show the whole turn"}
        </button>
      ) : null}
    </div>
  );
}

/** Every turn in order, each with its calls; calls whose turn is not on record follow at the end. */
export function Trace({ turns, calls }: { turns: readonly Turn[]; calls: readonly ToolCall[] }) {
  const [all, setAll] = useState(false);
  if (turns.length === 0 && calls.length === 0) {
    return <p className="ana-exam-side">No turn and no call on record</p>;
  }
  const ordered = turns.toSorted((one, other) => one.index - other.index);
  const shown = all ? ordered : ordered.slice(0, FIRST_TURNS);
  const numbers = new Set(ordered.map((turn) => turn.turn));
  const loose = calls.filter((call) => !numbers.has(call.turn));
  return (
    <div className="ana-trace">
      <ol className="ana-turns">
        {shown.map((turn) => {
          const own = calls.filter((call) => call.turn === turn.turn);
          return (
            <li key={turn.index} className="ana-turn">
              <div className="ana-turn-head">
                <strong>Turn {turn.turn}</strong>
                <span>{own.length === 1 ? "1 call" : `${String(own.length)} calls`}</span>
                {turn.stopReason === null || turn.stopReason === "toolUse" ? null : (
                  <span>{turn.stopReason}</span>
                )}
                {turn.billed === null ? null : <span className="ana-num">{money(turn.billed)}</span>}
                {turn.error === null ? null : (
                  <Badge tone="bad" title={turn.error}>
                    error
                  </Badge>
                )}
              </div>
              <TurnText text={turn.text} />
              {own.length === 0 ? null : (
                <ol className="ana-tool-list">
                  {own.map((call) => (
                    <ToolCallDetail key={call.index} call={call} />
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
      {ordered.length > shown.length ? (
        <Button onClick={() => setAll(true)}>Show all {ordered.length} turns</Button>
      ) : null}
      {loose.length === 0 ? null : (
        <ol className="ana-tool-list">
          {loose.map((call) => (
            <ToolCallDetail key={call.index} call={call} />
          ))}
        </ol>
      )}
    </div>
  );
}
