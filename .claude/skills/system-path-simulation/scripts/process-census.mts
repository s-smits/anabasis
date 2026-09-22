/**
 * A sampled census of the processes a simulation runner started, so a report can say which
 * observed descendants were still present at close. It samples `ps` on an interval and keeps every
 * descendant it ever saw; a child that started and exited between two samples is never observed,
 * which is why every field it produces says "sampled". It is closure evidence to read beside the
 * verifier lifetime receipts, never a proof of absence.
 */
import { runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";

export interface ObservedProcess {
  pid: number;
  ppid: number;
  /** `ps` lstart text; the same pid with another start is a different process. */
  started: string;
  command: string;
}

export interface ProcessCensusSnapshot {
  sampled: true;
  launcher: number;
  samples: number;
  intervalMs: number;
  /** Every descendant seen in any sample. */
  observed: ObservedProcess[];
  /** Observed descendants present at the latest sample, same pid and same start. */
  present: ObservedProcess[];
}

const PS_ROW = /^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/;

export interface ProcessCensus {
  snapshot(): ProcessCensusSnapshot;
  stop(): ProcessCensusSnapshot;
}

/** Parse `ps -axo pid,ppid,lstart,command` output; the header and unparseable rows are skipped. */
export function parseProcessTable(text: string): ObservedProcess[] {
  return text
    .trim()
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const row = PS_ROW.exec(line.trim());
      if (row === null) return [];
      const [, pid, ppid, started, command] = row;
      if (pid === undefined || ppid === undefined || started === undefined || command === undefined) {
        return [];
      }
      return [{ pid: Number(pid), ppid: Number(ppid), started, command }];
    });
}

/** Every transitive child of `rootPid` in one table, the root itself excluded. */
export function descendantsOf(rows: readonly ObservedProcess[], rootPid: number): ObservedProcess[] {
  const parents = new Set([rootPid]);
  for (let pass = 0; pass <= rows.length; pass += 1) {
    const before = parents.size;
    for (const row of rows) if (parents.has(row.ppid)) parents.add(row.pid);
    if (parents.size === before) break;
  }
  return rows.filter((row) => row.pid !== rootPid && parents.has(row.pid));
}

export function sampleProcessTable(): ObservedProcess[] {
  const result = runSync(["ps", "-axo", "pid,ppid,lstart,command"], { env: Bun.env });
  return parseProcessTable(decodeOutput(result.stdout));
}

/** Start sampling descendants of `rootPid` every `intervalMs`; `stop()` takes a final sample. */
export function startProcessCensus(intervalMs: number, rootPid: number = runtimeProcess.pid): ProcessCensus {
  const observed = new Map<string, ObservedProcess>();
  let present: ObservedProcess[] = [];
  let samples = 0;
  const sample = (): ProcessCensusSnapshot => {
    const rows = sampleProcessTable();
    const descendants = descendantsOf(rows, rootPid);
    for (const row of descendants) observed.set(`${row.pid}:${row.started}`, row);
    const live = new Set(rows.map((row) => `${row.pid}:${row.started}`));
    present = [...observed.values()].filter((row) => live.has(`${row.pid}:${row.started}`));
    samples += 1;
    return {
      sampled: true,
      launcher: rootPid,
      samples,
      intervalMs,
      observed: [...observed.values()],
      present,
    };
  };
  sample();
  const timer = setInterval(sample, intervalMs);
  return {
    snapshot: () => ({
      sampled: true,
      launcher: rootPid,
      samples,
      intervalMs,
      observed: [...observed.values()],
      present,
    }),
    stop: () => {
      clearInterval(timer);
      return sample();
    },
  };
}
