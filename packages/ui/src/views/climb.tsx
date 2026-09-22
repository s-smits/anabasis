import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip } from "../components/ui/chart.js";
import { NoSignal } from "../components/primitives.js";
import type { ClimbPoint } from "./climb-data.js";

function ClimbTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ClimbPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (active !== true || point === undefined) return null;
  return (
    <div className="ana-chart-tooltip">
      <strong>Evaluation {point.label}</strong>
      <div>
        {point.passed} / {point.verified} verified ·{" "}
        {point.rate === null ? "No score" : `${Math.round(point.rate * 100)}%`}
      </div>
      <small>
        {point.unaccepted} unaccepted · {point.nonResults} non-results
      </small>
      <small>{point.condition ?? "Model identity unavailable"}</small>
    </div>
  );
}

/** The Forge truth chart over Anabasis evidence and local styles. */
export function ImprovementChart({ points }: { points: ClimbPoint[] }) {
  if (!points.some((point) => point.rate !== null)) {
    return <NoSignal title="No measured climb yet">Dated, verified evaluations will appear here.</NoSignal>;
  }
  // A changed or missing model identity breaks the series; a missing score stays a gap.
  let segment = 0;
  const data = points.map((point, index) => {
    const previous = points[index - 1];
    if (previous !== undefined && (point.condition === null || point.condition !== previous.condition)) {
      segment += 1;
    }
    return { ...point, [`rate${segment}`]: point.rate };
  });
  const changes = points.filter((point, index) => index > 0 && point.taskSet !== points[index - 1]?.taskSet);
  return (
    <ChartContainer>
      <AreaChart accessibilityLayer data={data} margin={{ left: 4, right: 18, top: 24, bottom: 16 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={24}
          label={{ value: "Evaluation", position: "insideBottom", offset: -12, fill: "var(--ana-faint)" }}
        />
        <YAxis
          domain={[0, 1]}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          tickLine={false}
          axisLine={false}
          width={46}
        />
        {changes.map((point) => (
          <ReferenceLine key={point.id} x={point.label} stroke="var(--ana-border)" strokeDasharray="4 3" />
        ))}
        <ChartTooltip cursor={false} content={<ClimbTooltip />} />
        {Array.from({ length: segment + 1 }, (_, i) => (
          <Area
            key={i}
            dataKey={`rate${i}`}
            type="monotone"
            stroke="var(--ana-accent)"
            fill="var(--ana-accent)"
            fillOpacity={0.18}
            strokeWidth={2.5}
            connectNulls={false}
            isAnimationActive={false}
            dot={{ r: 4, fill: "var(--ana-accent)" }}
            activeDot={{ r: 6 }}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
