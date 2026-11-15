#!/usr/bin/env bun
/**
 * What a seat's shell may do under a tree's command wall, without a model: each command of a
 * battery runs as a seat's commands run (`runWalled`, `src/tools/command.ts`) in a seat root of its
 * own, and one tree's answers are set beside another's.
 *
 *   bun .claude/skills/system-path-simulation/scripts/wall-probe.ts <tree>
 *   bun .claude/skills/system-path-simulation/scripts/wall-probe.ts <before> <after> [--battery <file.ts>]
 *
 * One tree prints every command with its exit code and what it said; two print the commands whose
 * exit code or words differ, which is what a change to `src/wall` gave and took. A battery file
 * default-exports `Probe[]`; `BATTERY` below is the default. A command prints fixed words only
 * (`ok`, `rc=1`), never a path, a name or a listing of the host, so a table can be pasted, and it
 * does nothing a wall that fails would regret: none opens an application, writes the clipboard or
 * signals by pattern. Add the command to `BATTERY` when a seat is found refused something no row
 * reads: on 15 November 2026 the battery of that day read 68 commands alike or better under the
 * deny-by-default Darwin profile and missed file watchers, which the profile refuses.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { rmSync } from "#src/meta/filesystem.ts";
import { join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";

const USAGE = `usage: wall-probe.ts <tree> [<other tree>] [--battery <file.ts>]

Runs a battery of shell commands under each tree's command wall, with no model. One tree prints
every command; two print the commands whose exit code or output differs between them.`;
const OPTIONS = { battery: "abs" } as const;

interface Probe {
  readonly label: string;
  readonly run: string;
}

export interface Answer {
  readonly label: string;
  readonly exit: string;
  readonly said: string;
}

const BATTERY: readonly Probe[] = [
  { label: "python", run: "python3 -c 'print(1+1)'" },
  {
    label: "process pool",
    run: `cd "$HOME" && printf 'import multiprocessing as m\\nif __name__=="__main__":\\n    print(sum(m.Pool(2).map(abs,[-1,2])))\\n' > p.py && python3 p.py 2>&1 | tail -n 1`,
  },
  {
    label: "shared memory",
    run: "python3 -c 'from multiprocessing import shared_memory as s\nx=s.SharedMemory(create=True,size=64); x.close(); x.unlink(); print(\"ok\")' 2>&1 | tail -n 1",
  },
  {
    label: "venv and pip install",
    run: `python3 -m venv "$HOME/v" >/dev/null 2>&1 && "$HOME/v/bin/pip" -q --disable-pip-version-check install six >/dev/null 2>&1; "$HOME/v/bin/python" -c 'import six; print("ok")' 2>&1 | tail -n 1`,
  },
  { label: "bun", run: "bun -e 'console.log(1+1)' 2>&1 | tail -n 1" },
  {
    // The registry is asked first, so an install that hangs is told from a network that does: an
    // alarm ends the install inside the wall's own limit, and the row then reads `install=142`.
    label: "npm install",
    run: `command -v npm >/dev/null || { echo absent; exit 0; }; curl -s -m 15 -o /dev/null -w 'registry=%{http_code} ' https://registry.npmjs.org/is-number; mkdir -p "$HOME/n" && cd "$HOME/n" && echo '{"name":"n","version":"1.0.0"}' > package.json && { perl -e 'alarm shift; exec @ARGV' 40 npm install --no-audit --no-fund --silent is-number >/dev/null; } 2>/dev/null; echo "install=$?"; node -e "try { require('is-number'); console.log('ok') } catch { console.log('missing') }"`,
  },
  {
    // Headless, with a profile in the seat root, so no window opens; once as a browser starts by
    // default and once without its own sandbox, which a wall around it may refuse to nest.
    label: "headless browser",
    run: `c="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; [ -x "$c" ] || c="$(command -v chromium || command -v chromium-browser || command -v google-chrome)"; [ -x "$c" ] || { echo absent; exit 0; }; for flag in --disable-extensions --no-sandbox; do { perl -e 'alarm shift; exec @ARGV' 20 "$c" --headless=new --no-first-run --disable-gpu "$flag" --user-data-dir="$HOME/c$flag" --dump-dom 'data:text/html,<p id=a>ok</p>' | grep -c 'id="a"' | tr '\\n' ' '; echo "$flag=\${PIPESTATUS[0]}"; } 2>/dev/null; done`,
  },
  {
    label: "file watcher",
    run: `command -v node >/dev/null || { echo absent; exit 0; }; mkdir -p "$HOME/w" && cd "$HOME/w" && node -e "const fs=require('fs');let n=0;const w=fs.watch('.',()=>{n++});w.on('error',e=>console.log('error',e.code));setTimeout(()=>fs.writeFileSync('x','1'),500);setTimeout(()=>{console.log('events',n);process.exit()},2000)" 2>&1 | tail -n 2`,
  },
  {
    label: "cc, dlopen and codesign",
    run: `cd "$HOME" && echo 'int f(){return 7;}' > l.c && cc -shared l.c -o l.dylib 2>/dev/null; python3 -c "import ctypes;print(ctypes.CDLL('./l.dylib').f())" 2>&1 | tail -n 1; echo 'int main(){return 0;}' > c.c && cc c.c -o c && ./c; echo "run=$?"; command -v codesign >/dev/null && { codesign -f -s - c >/dev/null 2>&1; echo "codesign=$?"; }`,
  },
  {
    label: "git commit",
    run: `cd "$HOME" && git init -q r && cd r && echo x > f && git add f && git -c user.name=p -c user.email=p@example.invalid commit -q -m m && echo ok`,
  },
  {
    label: "curl https",
    run: "curl -s -m 20 -o /dev/null -w '%{http_code}' https://example.com; echo \" rc=$?\"",
  },
  {
    label: "git https",
    run: "git ls-remote https://github.com/git/git HEAD 2>/dev/null | wc -l | tr -d ' '",
  },
  {
    label: "dns",
    run: "python3 -c 'import socket; print(len(socket.getaddrinfo(\"example.com\",443))>0)' 2>&1 | tail -n 1",
  },
  {
    label: "loopback server",
    run: "python3 -m http.server 18765 --bind 127.0.0.1 >/dev/null 2>&1 & sleep 2; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18765/; kill %1; echo \" rc=$?\"",
  },
  {
    label: "unix socket in the root",
    run: `cd "$HOME" && python3 -c "import socket; a=socket.socket(socket.AF_UNIX); a.bind('s.sock'); a.listen(1); b=socket.socket(socket.AF_UNIX); b.connect('s.sock'); print('ok')" 2>&1 | tail -n 1`,
  },
  {
    label: "unix socket outside the root",
    run: `python3 -c "import socket; s=socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM); s.connect('/var/run/syslog'); print('ok')" >/dev/null 2>&1; echo "rc=$?"`,
  },
  {
    label: "links, clone, fifo, lock",
    run: `cd "$HOME" && echo a > a && ln a b && echo ln; cp -c a c 2>/dev/null && echo clone; mkfifo f && echo fifo; ln -s a sl && echo symlink; python3 -c "import fcntl;fcntl.flock(open('a'),fcntl.LOCK_EX);print('lock')" 2>&1 | tail -n 1`,
  },
  { label: "process substitution", run: "diff <(echo a) <(echo a); echo rc=$?" },
  {
    label: "standard streams by name",
    run: "echo x > /dev/stderr; echo stderr=$?; echo y | tee >(cat >/dev/null) >/dev/null; echo tee=$?; echo z > /dev/stdout; echo stdout=$?",
  },
  {
    label: "/tmp",
    run: 'stat /tmp >/dev/null 2>&1; echo stat=$?; ls /tmp >/dev/null 2>&1; echo ls=$?; (echo q > /tmp/wall-probe-q) 2>/dev/null; echo write=$?; f=$(mktemp) && echo x > "$f"; echo mktemp=$?',
  },
  {
    label: "own processes",
    run: "ps -o pid= -p $$ >/dev/null 2>&1; echo ps=$?; sleep 31.7 & sleep 0.3; pgrep -f 'sleep 31.7' >/dev/null 2>&1; echo pgrep=$?; lsof -p $$ >/dev/null 2>&1; echo lsof=$?; kill %1; echo kill=$?",
  },
  { label: "the parent", run: "kill -0 $PPID 2>/dev/null; echo kill0=$?" },
  {
    label: "pseudo-terminal",
    run: `python3 -c "import pty; pty.openpty(); print('ok')" >/dev/null 2>&1; echo rc=$?`,
  },
  {
    label: "priority",
    run: "nice -n 5 true 2>/dev/null; echo nice=$?; renice 5 $$ >/dev/null 2>&1; echo renice=$?",
  },
  {
    label: "host facts",
    run: "sysctl -n hw.ncpu >/dev/null; echo sysctl=$?; uptime >/dev/null; echo uptime=$?; df -h / >/dev/null; echo df=$?; id -un >/dev/null; echo id=$?",
  },
  {
    label: "java",
    run: "command -v java >/dev/null || { echo absent; exit 0; }; java -version >/dev/null 2>&1; echo rc=$?",
  },
];

/** The commands of `before` that `after` answers with another exit code or other words. */
export function differing(
  before: readonly Answer[],
  after: readonly Answer[],
): { label: string; before: Answer; after: Answer }[] {
  return before.flatMap((old) => {
    const now = after.find(({ label }) => label === old.label);
    return now === undefined || (now.exit === old.exit && now.said === old.said)
      ? []
      : [{ label: old.label, before: old, after: now }];
  });
}

/** Each command of `battery` under `tree`'s own wall, in one seat root that is removed after. */
async function answers(tree: string, battery: readonly Probe[]): Promise<Answer[]> {
  // SAFETY: each module is the tree's own copy of the one this file's types name; a tree whose
  // wall changed these signatures fails here, naming the call.
  const { command, base, seat } = {
    command: (await import(join(tree, "src/tools/command.ts"))) as typeof import("#src/tools/command.ts"),
    base: (await import(join(tree, "src/wall/base.ts"))) as typeof import("#src/wall/base.ts"),
    seat: (await import(join(tree, "src/wall/seat-root.ts"))) as typeof import("#src/wall/seat-root.ts"),
  };
  const dirs = command.solveDirs(`wall-probe-${String(runtimeProcess.pid)}`);
  const release = seat.claimRoot(dirs.root);
  try {
    command.makeSeatDirs(dirs);
    const policy = base.solveIsolationPolicy({ repoRoot: tree, otherTrees: [] });
    if ("unsupported" in policy) throw new Error(`this host cannot wall a command: ${policy.unsupported}`);
    const wall = {
      base: policy,
      dirs,
      toolTree: null,
      limits: { shellDefaultSeconds: 60, shellMaxSeconds: 60 },
    };
    const rows: Answer[] = [];
    for (const { label, run } of battery) {
      let said = "";
      const onData = (data: Buffer) => {
        said += data.toString("utf8");
      };
      let exit: string;
      try {
        exit = String((await command.runWalled(wall, run, { onData })).exitCode);
      } catch (error) {
        // A command past its limit throws `timeout:<seconds>`, which is its answer here.
        exit = `threw ${errorMessage(error).slice(0, 40)}`;
      }
      rows.push({ label, exit, said: said.replaceAll(/\s+/gu, " ").trim().slice(0, 160) });
    }
    return rows;
  } finally {
    await release();
    rmSync(dirs.host, { recursive: true, force: true });
  }
}

async function main(args: CommandArgs): Promise<number> {
  const file = args.value("battery");
  // SAFETY: a battery file's contract is a default export of probes; another shape fails in the
  // loop that reads its first row.
  const battery =
    file === null ? BATTERY : ((await import(file)) as { readonly default: readonly Probe[] }).default;
  const tables: Answer[][] = [];
  // One tree after the other: two walls at once would share the loopback port and the load.
  for (const tree of args.positionals) tables.push(await answers(resolve(tree), battery));
  const [first = [], second] = tables;
  if (second === undefined) {
    for (const { label, exit, said } of first) console.log(`${label} | exit ${exit} | ${said}`);
    return 0;
  }
  const moved = differing(first, second);
  for (const { label, before, after } of moved) {
    console.log(
      `${label}\n  before: exit ${before.exit} | ${before.said}\n  after:  exit ${after.exit} | ${after.said}`,
    );
  }
  console.log(`${String(moved.length)} of ${String(first.length)} commands differ`);
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "wall-probe", usage: USAGE, options: OPTIONS, positionals: [1, 2] }, main);
}
