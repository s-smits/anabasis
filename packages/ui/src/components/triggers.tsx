import type { Trigger } from "../../../../tools/wri/folds.ts";

/*
 * The whole-run reader's triggers (`overview`, `tools/wri/read.ts`): each lane that fired, by its
 * number and name, with the reader's own detail. The Log pane lists the campaign's, and a
 * comparison's detail the ones of its lanes, both collapsed by default.
 */
export function TriggerList({ triggers, none }: { triggers: readonly Trigger[]; none: string }) {
  if (triggers.length === 0) return <p className="ana-faint">{none}</p>;
  return (
    <ul className="ana-triggers">
      {/* Two triggers can share a lane and a name, and the list never reorders: keyed by place. */}
      {triggers.map((trigger, at) => (
        <li key={String(at)}>
          <span className="ana-num">lane {trigger.lane}</span>
          <strong>{trigger.name.toLowerCase()}</strong>
          <span>{trigger.detail}</span>
        </li>
      ))}
    </ul>
  );
}
