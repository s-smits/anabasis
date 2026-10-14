import { Section } from "../components/layout.tsx";
import { detailsOf, useTask, useTasks } from "../live.ts";
import type { PaneProps } from "../route.ts";
import { enter, Pending, useDrill } from "./drill.tsx";
import { useLate } from "./late.ts";
import { SolveView } from "./solve.tsx";
import { TaskDetailView } from "./tasks-detail.tsx";
import { TaskGridView } from "./tasks-grid.tsx";

/*
 * The Tasks pane (the brief of 11 October, section 7): the grid of task versions against comparisons
 * (`tasks-grid.tsx`); a task opens its detail in place through the route's `task`
 * (`tasks-detail.tsx`), and a solve in it through the route's `solve` (`solve.tsx`), each level
 * hiding the one above it as the Moves pane's do.
 *
 * The grid stays on screen until the task opened from it is read, and is marked as reading only
 * once that read is late (`late.ts`): until 14 October the grid gave way at once to a "Reading the
 * task" placeholder for the frames the server took to answer.
 */

export function TasksPane({ reading, navigation }: PaneProps) {
  const { task, solve } = navigation.route;
  const grid = useTasks(detailsOf(reading));
  const detail = useTask(detailsOf(reading), task);
  // The task shown: the one asked for once its detail is read, or once its read failed, which the
  // detail says. Until then the grid stays.
  const shown = task !== null && (detail.current || detail.error !== null) ? task : null;
  const late = useLate(task === null ? null : detail);
  const outer = useDrill(shown ?? (solve === null ? null : `solve:${solve}`));
  const inner = useDrill(solve);
  if (grid.data === null || !grid.current) {
    return (
      <Section title="Tasks">
        <Pending live={grid} what="the tasks" />
      </Section>
    );
  }
  return (
    <Section title="Tasks">
      <div
        ref={outer.list}
        hidden={shown !== null || solve !== null}
        className={late ? "is-reading" : undefined}
        aria-busy={late}
      >
        <p role="status" className="ana-sr-only">
          {late ? "Reading the task." : ""}
        </p>
        <TaskGridView grid={grid.data} onOpen={(version) => enter(navigation, { task: version })} />
      </div>
      {shown === null ? null : (
        <div
          ref={outer.detail}
          className="ana-drill"
          tabIndex={-1}
          aria-label="Selected task"
          hidden={solve !== null}
        >
          <div ref={inner.list}>
            {detail.data === null || !detail.current ? (
              <Pending live={detail} what="the task" />
            ) : (
              <TaskDetailView
                detail={detail.data}
                grid={grid.data}
                reading={reading}
                navigation={navigation}
              />
            )}
          </div>
        </div>
      )}
      {solve === null ? null : (
        <div ref={inner.detail} className="ana-drill" tabIndex={-1} aria-label={`Solve ${solve}`}>
          <SolveView
            reading={reading}
            navigation={navigation}
            back={{ solve: null }}
            backLabel={task === null ? "Back to tasks" : "Back to the task"}
          />
        </div>
      )}
    </Section>
  );
}
