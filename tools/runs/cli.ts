/**
 * `bun run runs <verb>`, over every run log in the repository's worktrees (`registry.ts`): `pulse`
 * says what each gained since the last look (`pulse.ts`), `zip` bundles them for handover
 * (`zip.ts`), `launch`, `continue` and `pause` start a campaign, go on with one and stop one at a
 * clean point (`manage.ts`), `fresh` starts one from a blank project in a worktree of its own (`fresh.ts`), and `stop` ends a run and releases what it held (`stop.ts`). `replay` puts every campaign log
 * through this tree's readers (`replay.ts`), `seed` copies a campaign under another name, cut where
 * a question starts (`seed.ts`), and `rehearse` runs a round over a seed with a script in each
 * model seat (`rehearse.ts`). `view` prints one campaign as its log reads: what each step handed
 * over, and the moves that may start next (`view.ts`), and `source` the commit each of its runs ran
 * and where that is published (`receipt.ts`). `status` gives one row a run (`pulse.ts`), `logins`
 * how much of each login is used (`logins.ts`), `keep` keeps a run going across logins (`keep.ts`),
 * `copy` takes a stopped campaign whole to another worktree (`manage.ts`), `move` takes one to another
 * machine and goes on with it there (`move.ts`), and `on` and `hosts` run a verb on another machine
 * (`hosts.ts`), and `fetch` takes a copy of a run another machine holds, to read here (`move.ts`). A verb that names a run no worktree here holds runs on the host that holds it
 * (`routed`), and `holds` is what that host is asked.
 */
import { runtimeProcess } from "#src/meta/process.ts";
import { fresh } from "./fresh.ts";
import { holds, hosts, on, routed, verbOn } from "./hosts.ts";
import { keep } from "./keep.ts";
import { logins } from "./logins.ts";
import { continueRun, copy, launch, pause } from "./manage.ts";
import { fetch, move } from "./move.ts";
import { runsStatus, watch } from "./pulse.ts";
import { source } from "./receipt.ts";
import { rehearse } from "./rehearse.ts";
import { replay } from "./replay.ts";
import { seed } from "./seed.ts";
import { stop } from "./stop.ts";
import { view } from "./view.ts";
import { zipRuns } from "./zip.ts";

const VERBS = {
  pulse: watch,
  zip: zipRuns,
  launch,
  fresh,
  continue: continueRun,
  pause,
  stop,
  replay,
  seed,
  rehearse,
  view,
  source,
  status: runsStatus,
  logins,
  usage: logins,
  keep,
  copy,
  move,
  fetch,
  on,
  hosts,
  holds,
};
const [verb, ...args] = Bun.argv.slice(2);
const run = Object.entries(VERBS).find(([name]) => name === verb)?.[1];
if (run === undefined) {
  console.error(
    `usage: bun run runs ${Object.keys(VERBS).join("|")} ..., each verb's options in its file's head`,
  );
  runtimeProcess.exitCode = 1;
} else {
  const { here, away } = await routed(verb ?? "", args);
  for (const [host, words] of away) {
    const code = await verbOn(host, words);
    if (code !== 0) runtimeProcess.exitCode = code;
  }
  if (here !== null) await run(here);
}
// With the code a verb set: a verb that refused is not a success.
runtimeProcess.exit();
