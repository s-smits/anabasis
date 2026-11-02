"""The placeholder's verifier: the task's hidden tests run by WorkBuddy-Bench's own pytest runner
inside the trial's container, scored by its pass-rate policy, so `score.json` is written the way a
Code task's is."""
from __future__ import annotations

from workbuddy_bench.judge import EvaluationPlan, JudgeSpec, PassRateScoringPolicy, VerifierRegistry
from workbuddy_bench.judge.runners.harbor_pytest import HarborPytestRuleJudgeRunner


def build_registry(context):
    def plan(ctx):
        command = f"python -m pytest -q {ctx.tests_dir} --junitxml={ctx.verifier_dir}/results.xml"
        judge = JudgeSpec(name="hidden-tests", type="pytest", config={"command": command, "timeout_sec": 300})
        return EvaluationPlan(dataset_id=ctx.dataset_id, task_id=ctx.task_id, judges=[judge])

    runner = HarborPytestRuleJudgeRunner(environment=context.runtime.environment)
    return VerifierRegistry(
        plan_builder=plan, scoring_policy=PassRateScoringPolicy(), judge_runners={"pytest": runner}
    )
