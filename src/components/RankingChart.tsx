import { useEffect, useRef, useState } from 'react';
import { init, use as registerCharts } from 'echarts/core';
import type { EChartsType } from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { Ranking } from '../lib/dashboard';
import { usePageActive } from './SessionPage';
registerCharts([BarChart, GridComponent, SVGRenderer]);

/**
 * The bar colour, read from the theme token rather than hardcoded.
 *
 * ECharts paints into SVG and knows nothing about CSS custom properties, so the
 * value has to be resolved to a concrete colour here. It was `#46765a`, which
 * measured 5.20:1 on the light card but only 3.04:1 on the dark one - passing the
 * 3:1 data-contrast floor by a hair, with no way for the theme to improve it.
 * Reading the token means the chart follows whichever theme is active and keeps
 * clearing the threshold with margin.
 */
function barColor(): string {
  if (typeof window === 'undefined') return '#46765a';
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--chart-bar')
    .trim();
  return value || '#46765a';
}

export default function RankingChart({ rows }: { rows: Ranking[] }) {
  const active = usePageActive();
  const ref = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);
  // Bumped on a theme switch to force the redraw effect below.
  const [draw, setDraw] = useState(0);
  // Drives the redraw on a theme switch; the observer below is about size.
  const theme = useRef(document.documentElement.dataset.theme ?? 'light');
  useEffect(() => {
    if (!active || !ref.current) return;
    const chart = init(ref.current, undefined, { renderer: 'svg' });
    instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    // A theme change must repaint the bars, because the colour is resolved from
    // CSS at draw time and would otherwise keep the previous theme's value.
    const themeObserver = new MutationObserver(() => {
      const next = document.documentElement.dataset.theme ?? 'light';
      if (next === theme.current) return;
      theme.current = next;
      setDraw((v) => v + 1);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
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
          itemStyle: { color: barColor(), borderRadius: 3 },
          data: rows.map((r) => Number((r.ticks * 10000n) / max) / 100),
        },
      ],
    });
  }, [rows, active, draw]);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="ranking-chart"
      style={{ height: rows.length * 64 }}
    />
  );
}
