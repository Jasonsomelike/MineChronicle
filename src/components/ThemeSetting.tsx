import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  applyTheme,
  loadThemePreference,
  saveThemePreference,
  watchSystemTheme,
} from '../lib/theme';
import type { ThemePreference } from '../lib/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '亮色', icon: Sun },
  { value: 'dark', label: '暗色', icon: Moon },
];

/**
 * Theme choice: follow the system, or pin light/dark.
 *
 * A three-way segmented control rather than a switch, because "follow the system"
 * is a real third state and not the same as "currently light": someone on a light
 * system who picks 暗色 needs the override to survive the system changing later.
 *
 * While the preference is 跟随系统 this also listens for OS changes, so the app
 * follows along without a restart.
 */
export default function ThemeSetting() {
  const [preference, setPreference] = useState<ThemePreference>('system');
  // The preference alone cannot say which theme is showing, because 'system'
  // resolves to one of two. This tracks the outcome for the caption.
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = loadThemePreference();
    setPreference(stored);
    setResolved(applyTheme(stored));
  }, []);

  useEffect(() => {
    if (preference !== 'system') return;
    return watchSystemTheme((theme) => {
      applyTheme('system');
      setResolved(theme);
    });
  }, [preference]);

  function choose(next: ThemePreference) {
    setPreference(next);
    saveThemePreference(next);
    setResolved(applyTheme(next));
  }

  const active = OPTIONS.find((option) => option.value === preference);

  return (
    <div className="setting-row">
      <div>
        <strong>
          <Moon size={16} /> 外观主题
        </strong>
        <p>
          暗色使用暖调深绿底色，与亮色同源，适配长时间查看统计数据。
          {preference === 'system'
            ? `当前跟随系统，正在显示${resolved === 'dark' ? '暗色' : '亮色'}。`
            : `已固定为${active?.label ?? ''}，不再随系统变化。`}
        </p>
      </div>
      <div className="theme-choice" role="radiogroup" aria-label="外观主题">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = option.value === preference;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className="theme-choice-option"
              onClick={() => choose(option.value)}
            >
              <Icon size={15} aria-hidden="true" />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
