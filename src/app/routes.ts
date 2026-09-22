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
