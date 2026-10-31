# Anabasis

A local, read-only page over v2's campaign logs: the v1 dashboard's shell and visual design, with
four panes rewritten for v2 (Campaign, Moves, Tasks, Log). See [DESIGN.md](DESIGN.md).

From the repository root:

```sh
bun run ui:deps
bun run ui:dev                      # the default tier
bun run ui:dev -- --exam-side       # adds task text, hidden values, answers and rulings
```

Bun hands the arguments after the script's name on through both levels of `bun run`, so the
last line starts `bun serve.ts --exam-side` in `packages/ui`, and the server says
`answering in the exam side` (checked on 11 October with Bun 1.4.2).

The server binds 127.0.0.1:5173 (`PORT` changes the port) and prints the page's address with its
token, drawn once and kept in the ignored `packages/ui/.token` so that a restart leaves open tabs
working, and kept by the page in the browser so that the bare address works too; every API request needs it, and a `Host` that is not the loopback is
refused. The page reads every campaign under `.ana/d2/` in the repository's worktrees, writes
nothing, and shows the exam side only on a server started with `--exam-side`, which belongs on a
host no Builder or solver shares. The Campaign picker groups the campaigns by the project their
opening names (`--project` on the campaign command); a campaign whose opening names none stands
under "No project recorded". Its search box forgives typos and matches each word apart (Fuse.js),
the closest campaign first. A warning dismissed with its cross stays dismissed in that browser
until the same source says something else.

To look at the page without a campaign of your own, write the test fixture's three campaigns to a
directory and point the server at it:

```sh
bun packages/ui/test/fixture-campaign.ts /tmp/ana-fixture
cd packages/ui && bun serve.ts --repo /tmp/ana-fixture
```

The browser tests (`test/browser-*.test.ts`) start `serve.ts` on that fixture and drive the
installed Google Chrome through Playwright, with Playwright's own assertions under `bun:test`;
`ANA_UI_CHROME=<path>` names another Chromium. They run with the rest of `packages/ui/test`:

```sh
bun run test -- packages/ui/test/browser-shell.test.ts   # one file
bun run test -- packages/ui/test                          # every UI test
```

`bun run ui:build` builds the page alone into `packages/ui/dist`: it carries no campaign data.
`bun run ui:gate` installs the locked UI dependencies, typechecks and builds the page, and runs
`packages/ui/test`; CI's macOS job runs it before the lint.
