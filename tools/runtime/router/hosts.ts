/**
 * The machines a routed check task may run on, for `run.sh`: one line a host, `<name> <ssh> <checks>`,
 * in the order `ANA_HOSTS` lists them, read by the one reader of that list (`hostsOf`). A host runs
 * checks only where its entry sets `checks`, the tasks it takes at once: until 28 October every host
 * the list named took two, so a peer kept for campaigns alone took checks too. `install.ts` bundles
 * this file into the installed runner as `hosts.js`, so the router reads the hosts through the same
 * code at whatever commit the tree it checks stands at.
 *
 * Until 25 October the runner on stijn-pro kept its own `hosts` file beside `ANA_HOSTS`: a second
 * registry of the same two machines, in the same order, which nothing kept in step with the first.
 */
import { hostsOf } from "../../runs/host-config.ts";

for (const host of hostsOf().filter((each) => each.checks !== undefined)) {
  console.log(`${host.name} ${host.ssh} ${String(host.checks)}`);
}
