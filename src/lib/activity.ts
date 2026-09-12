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
  initial_import: '首次导入历史',
  increment: '观察到时长增长',
  rollback: '统计回档',
};
export function formatCount(value: string) {
  return BigInt(value).toLocaleString('zh-CN');
}
export function formatDistance(cm: string) {
  const value = BigInt(cm);
  const absolute = value < 0n ? -value : value;
  const meters = absolute / 100n;
  return `${value < 0n ? '-' : ''}${meters.toLocaleString('zh-CN')}.${(
    absolute % 100n
  )
    .toString()
    .padStart(2, '0')} 米`;
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
    const raw = BigInt(value),
      absolute = raw < 0n ? -raw : raw;
    return `${raw < 0n ? '-' : ''}${(absolute / 10n).toLocaleString('zh-CN')}.${
      absolute % 10n
    } 点伤害`;
  }
  const suffix = { blocks: '块', items: '个', times: '次', none: '' }[unit];
  return `${formatCount(value)}${suffix ? ` ${suffix}` : ''}`;
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
