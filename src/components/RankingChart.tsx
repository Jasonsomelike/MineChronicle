import { useEffect, useRef } from 'react';
import { init, use as registerCharts } from 'echarts/core';
import type { EChartsType } from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { Ranking } from '../lib/dashboard';
import { usePageActive } from './SessionPage';
registerCharts([BarChart, GridComponent, SVGRenderer]);

export default function RankingChart({ rows }: { rows: Ranking[] }) {
  const active = usePageActive();
  const ref = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    const chart = init(ref.current, undefined, { renderer: 'svg' });
    instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, [active]);
  useEffect(() => {
    const chart = instance.current;
    if (!chart || !rows.length) return;
    const max = rows[0].ticks || 1n;
    chart.setOption({
      animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      animationDuration: 650,
      animationDurationUpdate: 350,
      animationEasing: 'cubicOut',
      grid: { left: 0, right: 0, top: 0, bottom: 0 },
      xAxis: { type: 'value', show: false, max: 100 },
      yAxis: {
        type: 'category',
        show: false,
        inverse: true,
        data: rows.map((r) => r.name),
      },
      series: [
        {
          type: 'bar',
          barWidth: 4,
          itemStyle: { color: '#46765a', borderRadius: 3 },
          data: rows.map((r) => Number((r.ticks * 10000n) / max) / 100),
        },
      ],
    });
  }, [rows, active]);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="ranking-chart"
      style={{ height: rows.length * 64 }}
    />
  );
}
