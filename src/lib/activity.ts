import { invoke, isTauri } from '@tauri-apps/api/core';
import { formatTickTotal } from './duration';
export type StatUnit =
  | 'ticks'
  | 'centimeters'
  | 'damage_tenths'
  | 'blocks'
  | 'items'
  | 'times'
  | 'none';
export interface StatResource {
  packs: string[];
  label: string | null;
  english: string | null;
  origin: string;
  translation_source: string | null;
  icon: {
    image: string;
    size: number;
    width?: number;
    height?: number;
    kind: string;
    source: string;
  } | null;
}
export interface ActivityScope {
  world_path: string;
  game_root: string;
  uuids: string[];
  world_paths?: string[] | null;
  game_roots?: string[] | null;
  instance_paths?: string[] | null;
  players_none?: boolean;
}
export type StatisticsSort = 'default' | 'value_desc' | 'value_asc';
export const statisticsGroups = [
  ['all', '全部'],
  ['interaction', '交互'],
  ['mined', '摧毁'],
  ['crafted', '合成'],
  ['used', '使用'],
  ['broken', '损坏'],
  ['picked_up', '拾取'],
  ['dropped', '丢弃'],
  ['killed', '杀死'],
  ['killed_by', '被杀'],
  ['custom', '常规'],
  ['other', '其他'],
] as const;
export type StatisticsGroup = (typeof statisticsGroups)[number][0];
export const emptyScope: ActivityScope = {
  world_path: '',
  game_root: '',
  uuids: [],
};
export interface TimelineEvent {
  id: number;
  kind: string;
  observed_at: string;
  world_path: string;
  world_name: string;
  uuid: string;
  player_name: string | null;
  play_ticks: string;
  delta_ticks: string;
  old_ticks: string | null;
  /**
   * How many raw observations this row merges. The observer records one increment
   * per reconcile pass (5 minutes), so an evening of play arrives as dozens of
   * rows; close ones are merged into a single run. 1 when the event stands alone.
   */
  merged_count?: number;
  /** When a merged run started. Absent for an event that stands alone. */
  first_observed_at?: string | null;
  /** The individual observations inside a merged run, oldest first. */
  parts?: {
    observed_at: string;
    delta_ticks: string;
    kind?: string;
    old_ticks?: string | null;
  }[];
  /**
   * What kinds a merged row is made of, most frequent first. A span can begin with
   * an import and a rollback before the increments, and this is how the row says so
   * instead of hiding those behind the merge.
   */
  kinds?: { kind: string; count: number }[];
}
export interface TimelinePage {
  events: TimelineEvent[];
  total: number;
  page_size: number;
}
export interface StatisticsPage {
  categories: { id: string; label: string; count: number }[];
  counters: Record<string, string>;
  rows: {
    category: string;
    key: string;
    category_label: string;
    label: string | null;
    unit: StatUnit;
    source_packs: string[];
    resource_roots?: string[];
    resources: StatResource[];
    value: string | null;
    sources: number;
    samples: string[];
  }[];
  total: number;
  page_size: number;
  sources: number;
  unavailable: number;
}
export function loadTimeline(
  filter: ActivityScope & {
    from?: string;
    to?: string;
    kind?: string;
    offset?: number;
  },
) {
  return isTauri()
    ? invoke<TimelinePage>('timeline', { filter })
    : Promise.resolve({ events: [], total: 0, page_size: 50 });
}
export function loadStatistics(
  filter: ActivityScope & {
    mode: string;
    query: string;
    offset: number;
    sort?: StatisticsSort;
    group?: StatisticsGroup;
  },
) {
  return isTauri()
    ? invoke<StatisticsPage>('statistics', { filter })
    : Promise.resolve({
        counters: {},
        categories: [],
        rows: [],
        total: 0,
        page_size: 100,
        sources: 0,
        unavailable: 0,
      });
}
export const eventNames: Record<string, string> = {
  // Every kind the backend can emit, so a row never falls back to showing a raw
  // identifier like `stats_changed`.
  initial_import: '首次导入历史',
  increment: '观察到时长增长',
  rollback: '统计回档',
  stats_changed: '统计数据变化',
  tracking_started: '开始追踪',
  // A merged row whose span contains more than one kind.
  mixed: '观测时段',
};
export function formatCount(value: string) {
  // Pure digits with grouping. Units never ride inside the mono stream.
  const n = BigInt(value);
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString();
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ',';
  }
  return neg ? `-${out}` : out;
}

/** Metres from centimetres as a pure number (`123.45`); unit is a micro suffix. */
export function formatDistance(cm: string) {
  const neg = cm.startsWith('-');
  const abs = neg ? cm.slice(1) : cm;
  if (!/^\d+$/.test(abs)) throw new Error('Distance must be integer cm');
  const n = BigInt(abs);
  const whole = n / 100n;
  let frac = (n % 100n).toString().padStart(2, '0');
  while (frac.endsWith('0')) frac = frac.slice(0, -1);
  return `${neg ? '-' : ''}${formatCount(whole.toString())}${
    frac ? `.${frac}` : ''
  }`;
}

/** Micro suffix beside a number; never embedded in the mono value. */
export function statisticUnitSuffix(unit: StatUnit): string {
  return (
    {
      ticks: '',
      centimeters: 'm',
      damage_tenths: 'HP',
      blocks: '块',
      items: '个',
      times: '次',
      none: '',
    } as Record<StatUnit, string>
  )[unit];
}

export function formatStatistic(value: string, unit: StatUnit = 'none') {
  if (unit === 'ticks') {
    const ticks = BigInt(value);
    return `${ticks < 0n ? '-' : ''}${formatTickTotal(
      (ticks < 0n ? -ticks : ticks).toString(),
    )}`;
  }
  if (unit === 'centimeters') return formatDistance(value);
  if (unit === 'damage_tenths') {
    const n = BigInt(value);
    const abs = n < 0n ? -n : n;
    return `${n < 0n ? '-' : ''}${formatCount((abs / 10n).toString())}.${
      abs % 10n
    }`;
  }
  return formatCount(value);
}

export function statisticRawTitle(value: string, unit: StatUnit) {
  const rawUnit =
    {
      ticks: '游戏刻',
      centimeters: '厘米',
      damage_tenths: '（每 10 对应 1 点伤害）',
      blocks: '块',
      items: '个',
      times: '次',
      none: '',
    }[unit] ?? '';
  return `原始读数：${formatCount(value)} ${rawUnit}`.trim();
}
