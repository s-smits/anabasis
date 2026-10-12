import { Section } from "../components/layout.tsx";
import { detailsOf, useTask, useTasks } from "../live.ts";
import type { CampaignReading, TaskGrid } from "../models.ts";
import type { Navigation, PaneProps } from "../route.ts";
import { enter, Pending, useDrill } from "./drill.tsx";
import { SolveView } from "./solve.tsx";
import { TaskDetailView } from "./tasks-detail.tsx";
import { TaskGridView } from "./tasks-grid.tsx";

/*
 * The Tasks pane (the brief of 11 October, section 7): the grid of task versions against comparisons
 * (`tasks-grid.tsx`); a task opens its detail in place through the route's `task`
 * (`tasks-detail.tsx`), and a solve in it through the route's `solve` (`solve.tsx`), each level
 * hiding the one above it as the Moves pane's do.
 */

/** The task the route names, read and shown. */
function TaskView({
  reading,
  navigation,
  grid,
}: {
  reading: CampaignReading;
  navigation: Navigation;
  grid: TaskGrid;
}) {
  const { task } = navigation.route;
  const live = useTask(detailsOf(reading), task);
  if (live.data === null || !live.current) {
    return <Pending live={live} what="the task" />;
  }
  return <TaskDetailView detail={live.data} grid={grid} reading={reading} navigation={navigation} />;
}

export function TasksPane({ reading, navigation }: PaneProps) {
  const { task, solve } = navigation.route;
  const grid = useTasks(detailsOf(reading));
  const outer = useDrill(task ?? (solve === null ? null : `solve:${solve}`));
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
      <div ref={outer.list} hidden={task !== null || solve !== null}>
        <TaskGridView grid={grid.data} onOpen={(version) => enter(navigation, { task: version })} />
      </div>
      {task === null ? null : (
        <div
          ref={outer.detail}
          className="ana-drill"
          tabIndex={-1}
          aria-label="Selected task"
          hidden={solve !== null}
        >
          <div ref={inner.list}>
            <TaskView reading={reading} navigation={navigation} grid={grid.data} />
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
