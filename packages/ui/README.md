# Anabasis

A local, read-only web interface for inspecting v2 campaign logs. It retains the v1 shell and visual identity while providing four panes tailored to v2 (Campaign, Moves, Tasks and Log). See [DESIGN.md](DESIGN.md) for layout and typographic conventions.

From the repository root:

```sh
bun run ui:deps
bun run ui:dev                      # the default tier
bun run ui:dev -- --exam-side       # adds task text, hidden values, answers and rulings
```

Because Bun forwards arguments after the script name across nested `bun run` invocations, the final command executes `bun serve.ts --exam-side` inside `packages/ui`, and the server logs `answering in the exam side`.

The server listens on `127.0.0.1:5173` (configurable via `PORT`) and prints the page URL together with an access token. The token is generated once and persisted in the git-ignored file `packages/ui/.token` so open browser tabs survive server restarts, and the client caches it in the browser so the bare address continues to work. Every API request requires this token, and any non-loopback `Host` header is rejected.

The interface reads every campaign under `.ana/d2/` across repository worktrees without writing to disk. Exam-side data is exposed only when the server is started with `--exam-side`, which should be run exclusively on hosts not shared with any Builder or solver seat. The Campaign picker groups campaigns by the project declared at launch (`--project`), placing untagged campaigns under "No project recorded". Fuzzy search (Fuse.js) matches each query word independently with typo tolerance and ranks the closest match first. Dismissed warning banners stay suppressed in that browser until the same source emits a different message.

To inspect the interface without live campaign logs, generate the three fixture campaigns into a temporary directory and launch the server against it:

```sh
bun packages/ui/test/fixture-campaign.ts /tmp/ana-fixture
cd packages/ui && bun serve.ts --repo /tmp/ana-fixture
```

Pre-render view-model logic (URL state, formatted metrics and Campaign chart series) is verified without a browser in `test/view-model.test.ts`. Two end-to-end smoke tests (`test/browser-smoke.test.ts`) launch `serve.ts` against the fixture and drive Google Chrome via Playwright under `bun:test`, verifying that the default tier neither renders nor receives exam-side payloads and that every pane fits a mobile viewport and passes axe accessibility checks. Set `ANA_UI_CHROME=<path>` to test with an alternative Chromium binary. Run the UI test suite with:

```sh
bun run test -- packages/ui/test/browser-smoke.test.ts   # the browser alone
bun run test -- packages/ui/test                          # every UI test
```

`bun run ui:build` compiles the static client bundle into `packages/ui/dist` without embedding campaign data. `bun run ui:gate` installs locked UI dependencies, typechecks and builds the bundle, and runs `packages/ui/test`; CI's macOS job executes it before linting.
