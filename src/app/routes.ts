import {
  LayoutDashboard,
  Layers3,
  Globe2,
  Settings2,
  Radar,
  History,
  BarChart3,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const PAGE_IDS = [
  'dashboard',
  'instances',
  'worlds',
  'timeline',
  'statistics',
  'observation',
  'settings',
] as const;

export type PageId = (typeof PAGE_IDS)[number];

export const PAGE_LABELS: Record<PageId, string> = {
  dashboard: '生涯概览',
  instances: '游戏实例',
  worlds: '世界与玩家',
  timeline: '时间线',
  statistics: '更多统计',
  observation: '实例观测',
  settings: '导入与设置',
};

export const PAGE_ICONS: Record<PageId, LucideIcon> = {
  dashboard: LayoutDashboard,
  instances: Layers3,
  worlds: Globe2,
  timeline: History,
  statistics: BarChart3,
  observation: Radar,
  settings: Settings2,
};

/**
 * The two groups the seven destinations collect into.
 *
 * Seven destinations at one level read as a draft: the list says nothing about
 * which of them are where the work happens (档案) and which configure the app
 * (观测与设置). The grouping is the page's shape, so it is declared next to the
 * pages rather than assembled in the shell, and the shell renders whatever order
 * this array is in.
 *
 * Two groups, not three: there used to be a 概览 group holding 生涯概览 alone,
 * which was a heading over one item - hierarchy for nothing, since a group's only
 * job is to say "these several go together". 档案 starts at 生涯概览 because the
 * overview IS where the archive's reading begins; the group it joins describes what
 * it is, not where it used to sit. `routes.test.ts` holds the shape with a "every
 * group has at least two entries" gate so a one-item group cannot come back.
 *
 * A group is a heading plus its destinations - not a destination itself, which is
 * why the labels are here and not in `PAGE_LABELS`.
 */
export const PAGE_GROUPS = [
  ['archive', '档案'],
  ['ops', '观测与设置'],
] as const;

export type PageGroupId = (typeof PAGE_GROUPS)[number][0];

/** Every page belongs to exactly one group; `routes.test.ts` holds that. */
export const PAGE_GROUP_OF: Record<PageId, PageGroupId> = {
  dashboard: 'archive',
  instances: 'archive',
  worlds: 'archive',
  timeline: 'archive',
  statistics: 'archive',
  observation: 'ops',
  settings: 'ops',
};

export const SETTINGS_SECTIONS = [
  ['settings-identity', '身份'],
  ['settings-startup', '启动与显示'],
  ['settings-import', '导入与联动'],
  ['settings-archive', '档案与备份'],
  ['settings-health', '数据健康'],
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number][0];

export function routePage(hash = window.location.hash): PageId {
  const page = hash.replace(/^#\/?/, '');
  if (page === 'health') return 'settings';
  return (PAGE_IDS as readonly string[]).includes(page)
    ? (page as PageId)
    : 'dashboard';
}

export function pageHash(page: PageId): string {
  return `#/${page}`;
}
