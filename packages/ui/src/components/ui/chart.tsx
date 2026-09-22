// shadcn ChartContainer, with its utility styles
// expressed in the shared stylesheet used by the Bun app.
import { useId, type ComponentProps } from "react";
import { ResponsiveContainer, Tooltip } from "recharts";

export const ChartTooltip = Tooltip;
export function ChartContainer({
  children,
}: {
  children: ComponentProps<typeof ResponsiveContainer>["children"];
}) {
  const id = useId();
  return (
    <div data-slot="chart" data-chart={id} className="ana-climb-chart">
      <ResponsiveContainer initialDimension={{ width: 900, height: 360 }}>{children}</ResponsiveContainer>
    </div>
  );
}
