#!/usr/bin/env bun
/** Operator timer only. Controller evidence remains owned by fullrun. */
import { existsSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { serviceManager, type ServiceManager } from "./service.ts";

interface StopPlan {
  dir: string;
  runId: string;
  service: string;
  deadline: number;
  grace: number;
}
type Result = { code: number; out: string };
type Control = (args: string[]) => Promise<Result>;
/** The worktree-relative receipt the timer writes; `launch.ts` waits on its `.ready` sibling
 *  and refuses to launch once the receipt itself exists. */
export const STOP_RECEIPT_PATH = ".scratch/quick-run/stop.json";

const label = (plan: StopPlan) => `ana.fullrun.${plan.runId}`;
export function validateStopPlan(plan: StopPlan, manager: ServiceManager = serviceManager()): void {
  if (
    !isAbsolute(plan.dir) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,85}$/.test(plan.runId) ||
    !manager.validService(plan.service, label(plan)) ||
    !Number.isSafeInteger(plan.deadline) ||
    plan.deadline <= 0 ||
    !Number.isSafeInteger(plan.grace) ||
    plan.grace <= 0
  ) {
    throw new Error("stop requires an absolute worktree, exact run service, and positive deadline/grace");
  }
}

const control: Control = async (args) => {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, out: out + err };
};

/** Never address a service that belongs to another worktree. */
export function ownedService(
  result: Result,
  plan: StopPlan,
  manager: ServiceManager = serviceManager(),
): "absent" | "owned" {
  if (manager.absent(result.code, result.out)) return "absent";
  if (result.code !== 0 || !manager.owned(result.out, plan.dir, label(plan))) {
    throw new Error(`stop refused: ${manager.name} did not bind the service to this run's worktree`);
  }
  return "owned";
}

export async function stopRun(
  plan: StopPlan,
  command: Control = control,
  sleep = Bun.sleep,
  manager: ServiceManager = serviceManager(),
) {
  validateStopPlan(plan, manager);
  const owned = async () => ownedService(await command(manager.query(plan.service)), plan, manager);
  const before = await command(manager.query(plan.service));
  if (ownedService(before, plan, manager) === "absent") {
    return { outcome: "already-absent", service: plan.service };
  }
  const signal = manager.stopped(before.out)
    ? { code: 0, out: "" }
    : await command(manager.terminate(plan.service));
  if (signal.code !== 0 && (await owned()) !== "absent") {
    throw new Error(`stop failed: ${manager.name} refused SIGTERM`);
  }
  await sleep(plan.grace);
  if ((await owned()) === "owned") {
    await command(manager.remove(plan.service));
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await owned()) === "absent") return { outcome: "service-absent", service: plan.service };
      await sleep(100);
    }
    throw new Error("stop failed: controller service is still present after removal");
  }
  return { outcome: "service-absent", service: plan.service };
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      worktree: { type: "string" },
      run: { type: "string" },
      service: { type: "string" },
      deadline: { type: "string" },
      grace: { type: "string" },
    },
  });
  const plan = {
    dir: values.worktree ?? "",
    runId: values.run ?? "",
    service: values.service ?? "",
    deadline: Number(values.deadline),
    grace: Number(values.grace),
  };
  validateStopPlan(plan);
  const receipt = join(plan.dir, STOP_RECEIPT_PATH);
  if (existsSync(receipt)) throw new Error("stop receipt already exists; inspect it before scheduling again");
  writeFileSync(`${receipt}.ready`, JSON.stringify(plan), { flag: "wx", mode: 0o600 });
  await Bun.sleep(Math.max(0, plan.deadline - Date.now()));
  try {
    const result = await stopRun(plan);
    writeFileSync(receipt, JSON.stringify({ ...plan, ...result, observedAt: new Date().toISOString() }), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    writeFileSync(receipt, JSON.stringify({ ...plan, outcome: "failed", error: String(error) }), {
      flag: "wx",
      mode: 0o600,
    });
    throw error;
  }
}
