"""PiAgent: a Harbor installed agent that solves a task with an Anabasis harness inside the
benchmark's container, through the study's container solver (studies/shared/pi-solve.ts).

The arm's mount (studies/shared/bundle.ts) is bind-mounted read-only at PI_MOUNT: the solver
compiled to one executable, `pi-solve`, and the harness beside it, `harness/`. The model is
reached through the benchmark's own proxy on the host (`model_connection: local_proxy`), as
WorkBuddy's cbc agent and Harness²'s OpenCode agent reach it: the URL comes in the `connection`
kwarg prepare_job injects, and the bearer token is `{trial}::{route}`, which selects the job's
route and attributes each request to its trial. The proxy holds the provider's key and adds the
model config's parameters, so every arm's requests take one path, and a direct connection is
refused. The model keeps pi's catalogue entry (PI_MODEL) for its prices, and the proxy rewrites
the model it names to the route's backend model. The solver writes its trace, its ATIF
trajectory and its result into /logs/agent, and this agent reads the result's tokens and billed
dollars into the trial's context.

The study copies this file into the benchmark's agents folder at setup; it is the study's own,
written for Harbor's BaseInstalledAgent the way the benchmark's Codex agent is.
"""
from __future__ import annotations

import base64
import json
import shlex
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from workbuddy_bench.agents._agent_user import ensure_agent_user

_RESULT_FILENAME = "pi-result.json"
_INSTRUCTION_FILENAME = "instruction.md"
_STDERR_FILENAME = "pi-stderr.log"


class PiAgent(BaseInstalledAgent):
    """An Anabasis harness on pi's coding agent, one solve a trial."""

    def __init__(self, logs_dir: Path, *args, **kwargs):
        self._mount = str(kwargs.pop("PI_MOUNT", "/opt/anabasis")).rstrip("/")
        self._model = str(kwargs.pop("PI_MODEL", ""))
        self._effort = str(kwargs.pop("PI_EFFORT", "high"))
        self._model_turns = int(kwargs.pop("PI_MODEL_TURNS", 20))
        self._wall_minutes = int(kwargs.pop("PI_WALL_MINUTES", 30))
        self._prompts = int(kwargs.pop("PI_PROMPTS", 24))
        self._dry_run = bool(kwargs.pop("PI_DRY_RUN", False))
        self._workdir = str(kwargs.pop("PI_WORKDIR", "/workspace"))
        connection = kwargs.pop("connection", None) or {}
        self._mode = str(connection.get("mode") or "direct")
        self._proxy_url = str(connection.get("proxy_url") or "")
        # logs_dir is ``.../<trial>/agent``; the trial half of the token, as cbc_agent sends it.
        self._trial = Path(logs_dir).parent.name if Path(logs_dir).name == "agent" else ""
        for unused in ("model_params", "context_window", "context_compact_pct",
                       "settings_preset", "models_preset", "mount_path", "instance_id"):
            kwargs.pop(unused, None)
        super().__init__(logs_dir, *args, **kwargs)

    @staticmethod
    def name() -> str:
        return "anabasis-pi"

    def get_version_command(self) -> str | None:
        return f"cat {shlex.quote(self._mount)}/mount.json"

    async def install(self, environment: BaseEnvironment) -> None:
        """Refuse a trial whose mount is missing, then make the agent's user."""
        solver = shlex.quote(f"{self._mount}/pi-solve")
        await self.exec_as_root(
            environment,
            command=(
                f"if [ ! -x {solver} ]; then "
                f"echo 'ERROR: no Anabasis arm mounted at {self._mount}; the job must bind-mount "
                f"the arm read-only (environment_override.mounts)' >&2; exit 1; fi"
            ),
        )
        await ensure_agent_user(self, environment)

    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        instruction = self.render_instruction(instruction)
        if self._mode != "local_proxy" or not self._proxy_url:
            raise RuntimeError("anabasis-pi runs only through the job's proxy (model_connection: local_proxy)")
        url = self._proxy_url.rstrip("/")
        # The proxy serves OpenAI clients on /v1/chat/completions, and pi appends the last part.
        url = url if url.endswith("/v1") else f"{url}/v1"
        route = self.model_name or ""
        key = f"{self._trial}::{route}" if self._trial else route
        blob = base64.b64encode(instruction.encode()).decode()
        asked = f"/logs/agent/{_INSTRUCTION_FILENAME}"
        flags = [
            "--harness", f"{self._mount}/harness",
            "--instruction", asked,
            "--model", self._model,
            "--base-url", url,
            "--effort", self._effort,
            "--model-turns", str(self._model_turns),
            "--wall-minutes", str(self._wall_minutes),
            "--prompts", str(self._prompts),
            "--logs", "/logs/agent",
        ]
        if self._dry_run:
            flags.append("--dry-run")
        home_fix = 'export HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"; '
        command = (
            f"{home_fix}"
            f"echo {blob} | base64 -d > {asked} && "
            f"cd {shlex.quote(self._workdir)} && "
            f'{shlex.quote(self._mount)}/pi-solve {" ".join(shlex.quote(f) for f in flags)} '
            f"--key {shlex.quote(key)} </dev/null 2>/logs/agent/{_STDERR_FILENAME}"
        )
        await self.exec_as_agent(environment, command=command)

    def populate_context_post_run(self, context: AgentContext) -> None:
        path = self.logs_dir / _RESULT_FILENAME
        try:
            result = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            self.logger.warning("no readable %s: %s", path, exc)
            return
        tokens = result.get("tokens") or {}
        # Harbor counts every input token here, cache reads and writes among them (AgentContext).
        context.n_input_tokens = sum(int(tokens.get(key) or 0) for key in ("input", "cacheRead", "cacheWrite"))
        context.n_output_tokens = int(tokens.get("output") or 0)
        context.n_cache_tokens = int(tokens.get("cacheRead") or 0)
        if isinstance(result.get("billed"), (int, float)):
            context.cost_usd = float(result["billed"])
