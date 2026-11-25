# The Built Harness's toolchain: source in the tree, environment and build by the harness

Status (25 November 2026): step 0 is read; step 1 is present in source and proved without a model;
steps 2 to 4 are planned. The counts come from the archived logs and kept states under `data/runs/`
(249 runs with shell calls, 21 of them opened on or after 18 November), read once with operator-side
scripts that count events and file headers and quote nothing a seat wrote.

## The question

A Builder installs what its programs and the solver's commands need inside `.toolchain/`, which the
host stores as bytes, content-addressed, and rebuilds for another machine when a reference leaves its
host (`studies/shared/foreign-python.ts`, `src/harness/place.ts`). Does the Builder get what it
wants into the tree, does the solver reach it, and is storing built bytes the right primitive?

## What the archive shows

- **The Builder's installs mostly work.** 241 install commands in 117 runs, 28 of them errored and 10
  refused by the network. Since 18 November the Builder installs almost nothing (5 commands in 3 of 21
  runs): the host's pinned Python carries the common scientific packages, and the Builder writes
  programs instead (1,069 of its shell calls touch `.toolchain/`).
- **The solver's own `python3` could not import the harness's modules.** Of 299 states kept since 18
  November, 187 keep Python modules in `.toolchain/lib` and ship no `python3` launcher; the host put
  `.toolchain/bin` on `PATH` and nothing on the import path. A solver that imported a harness module
  from its own command failed with `No module named` 300 times in 8 runs (158 in one run since 18
  November, where 281 imports went through, mostly by a Builder-written launcher). 40 kept trees carry
  such a launcher (`run-python`), and 333 carry a `python3` shim or copied interpreter.
- **Solves still install per solve what the pinned set lacks.** Since 18 November, 198 solver install
  commands in 14 runs, all of packages outside the pinned set (`numdifftools`, `lifelines`), and 0
  refused by the network. Each solve repeats them, because a solve's home is fresh.
- **Copied interpreters are the expensive layer.** 195 of 1,725 kept trees hold a virtual environment
  or `site-packages`, the source of trees above 100 MB and of the 307-line rebuild in
  `foreign-python.ts`. None of the 299 states kept since 18 November copies an interpreter.
- **Breakage reaches no verdict.** 0 `broken-harness` outcomes in the archive: a missing module costs
  turns inside a solve, not a typed outcome, so it shows only in call counts.

- **The Builder writes and builds in many languages, not Python alone.** Of 1,560 kept states'
  `.toolchain/` trees, 363 hold C source, 94 C++, 82 Fortran, 105 R and 515 JavaScript; 402 hold a
  Mach-O executable, 57 an ELF one and 360 a shared library. A built binary runs on any machine
  like the Builder's, and `foreignFiles` (`src/harness/place.ts`) refuses it on any other, so the
  Linux bench cannot run what a Mac Builder compiled.

## Where the brittleness comes from

Two things the Builder cannot express today make the tree brittle.

- **It cannot set the solver's environment.** The host rebuilds a walled shell's environment for
  every command (`src/sandbox/isolation.ts:commandIsolationEnvironment`), so a harness reaches the solver
  only through files. Import paths for Python, R, Java or Node, and library paths for its own native
  code, can be set only by a launcher wrapping each program. A bare `python3 -c 'import m'` from
  the solver misses.
- **It cannot say how to rebuild what it built.** Virtual environments, compiled programs and copied
  interpreters are bytes for one machine. Everything that moves a harness to another machine
  (`foreign-python.ts`, `foreignFiles`, `UV_VENV_RELOCATABLE`) exists to cope with those bytes.

The plan gives the Builder two files and the host one rule for each.

| Path | In the harness digest | Owner | Role |
| --- | --- | --- | --- |
| `.toolchain/bin/`, `.toolchain/lib/`, sources | yes | Builder | programs and modules, portable |
| `.toolchain/env.sh` | yes | Builder | the environment of every seat command, any language |
| `.toolchain/setup` | yes | Builder | builds what is machine-specific, into a cache outside the tree |
| the setup cache | no | host | one per machine and tree digest, read-only to seats |

## Intended changes, cheapest first

0. **Check wheels before locking Python packages** (read). Read on 25 November with uv 0.13.8: 17
   packages that solves and Builders reached for (`numpy`, `scipy`, `pandas`, `statsmodels`,
   `matplotlib`, `scikit-learn`, `ortools`, `openpyxl`, `numdifftools`, `lifelines`, `viennarna`,
   `pyscipopt`, `pulp`, `phreeqpython`, `tabulate`, `torch`, `pymc`) resolve from binary wheels alone
   for Python 3.14 on macOS arm64 and Linux x86-64, 34 of 34. A Python lock needs no source build.
1. **Put `.toolchain/lib` on the seats' import path** (present in source, proved without a model).
   - `toolTreeImports` (`src/sandbox/isolation.ts`) names the tree's `lib` when it exists. Three places
     read it: the seats' walled shells (`src/tools/command.ts:runSandboxed`), the bench's shell
     (`studies/shared/pi-solve.ts`) and the bundle's interpreter probe (`studies/shared/bundle.ts`).
   - The Verifier's environment is unchanged. The Examiner's tree holds only the host's
     pinned-engine shims (`src/examiner/shell.ts`), so no check sees the change.
   - Departure from the first draft of this plan (25 November 2026, 18:20 UTC): the draft had
     HARNESS.md route Python packages into `lib` with `pip --target`, and set the path in every
     walled shell. Compiled packages in `lib` would carry one machine's bytes into the digest, and
     the Verifier runs frozen checks. So the route is gone, and the path covers seat shells and the
     bench only.
   - Prediction for the first fresh run at this commit: 0 solver `No module named <m>` where `<m>`
     is a module in that run's own `.toolchain/lib`. Falsified by any such miss.
   - This step is a stopgap with one language's name in host code. Step 2 replaces it.
2. **Let the harness own its environment** (planned).
   - Every seat command already runs as `/bin/bash -c` inside the wall. Where a tool tree holds
     `env.sh`, the host sets `BASH_ENV` to it, and bash sources it before every command, in the
     solver's and Builder's shells and on the bench.
   - The Builder writes there whatever its programs and the solver need: `PYTHONPATH`,
     `R_LIBS_USER`, `CLASSPATH`, `NODE_PATH`, `LD_LIBRARY_PATH`, more of `PATH`. Paths are named
     relative to the file (`${BASH_SOURCE%/*}`).
   - Read on 25 November on macOS's bash 3.2: the file is sourced before `-c`,
     `${BASH_SOURCE%/*}` names its directory, and child processes, including `sh` and `python3`,
     inherit the exports.
   - A failing line in the file does not fail the command (exit 0 after a sourced `false`). So at
     freeze, `src/harness/files.ts` sources it once in the Builder's wall and refuses a harness whose
     `env.sh` exits non-zero or names a path under the Builder's home.
   - HARNESS.md states the fact once, in place of step 1's sentence. `toolTreeImports` and its
     three readers are deleted in the same change: one owner per fact (rule 12).
   - Kept trees without `env.sh` lose the import path step 1 gave them; no run before step 1 had it.
   - Wall: `env.sh` is harness content the solver may already read. Limits stay host-owned outside
     the shell (rule 11), and the Verifier never sources it.
   - Prediction for the first fresh run at that commit: at least one kept state writes `env.sh`, 0
     solver `No module named <m>` for its own modules, and no new launcher that only sets a path.
3. **Let the harness rebuild itself per machine** (planned).
   - The Builder may write an executable `.toolchain/setup`. Examples: `uv sync --frozen` against a
     lock, `cmake` and `make` for C, C++ or Fortran, `cargo build`, `R CMD INSTALL`, `npm ci`.
   - When a harness opens on a machine whose cache lacks its digest, the host runs `setup` once.
     That covers `src/harness/open.ts` for campaigns and `studies/shared/bundle.ts` for the bench.
     Before any solve, the host runs it in a walled shell with the Builder's network and limits,
     with one writable directory outside the tree, named by a host variable that `env.sh` reads.
   - The cache is keyed by machine, pinned Python and tree digest, and is read-only to seats.
     Setup's exit, duration and output digest are logged, so a reading can name what each machine
     built.
   - At freeze, `setup` must succeed on the Builder's own machine. Build outputs inside the tree
     (`.venv/`, build directories, binaries that `setup` makes) leave the digest.
   - Python packages become one line of `setup`; nothing in the host names a language.
   - Check before landing:
     - freeze a harness on macOS arm64 holding C source, a Python lock and an `env.sh`;
     - open it on Linux x86-64 and run every program's `--help`, counting failures;
     - confirm that freezing with and without the build outputs gives one digest.
   - Risk: a `setup` that resolves unlocked versions builds different bytes per machine. Locking is
     the Builder's to do, and the logged output digest shows the difference.
4. **Delete the rebuild** (planned, after step 3). Once no bench target predates step 3, these go:
   - `foreign-python.ts`;
   - `UV_VENV_RELOCATABLE` and `PIP_BREAK_SYSTEM_PACKAGES` in the walled shell;
   - the binary half of the bench's portability checks.

   `foreignFiles` stays, to refuse a binary left in the tree. Expected: 250 to 300 fewer production
   lines.

Not planned, for want of evidence (rule 13), or because steps 2 and 3 cover it:
- a host-set path per language;
- a Python-only lock materialiser (the earlier step 2 of this plan);
- a shared `uv` cache for the Builder (5 Builder installs since 18 November);
- naming the pinned packages in the Builder's opening (0 states since 18 November vendor them).

## History, in the operator's words

- "how can we do this better actually? are we using a brittle / outdated mechanism?"
- "but does the agent manage to do what it wants?"
- "okay make the lowest hanging fruit .toolchain improvements, if this means overhauling it to
  another mechanism / base that's fine for me, build out full plan"
- A review of the first draft, pasted by the operator: "Hold off on committing ... That pass skipped
  the overhaul plan you asked for"
- "what if it wants to write C++ / C etc?"
- "and all other languages?? why don't we allow to put the agent to set up it's paths itself? why
  does it even have to set up a python path?"
- "tune the plan now that this implementation has been done"
