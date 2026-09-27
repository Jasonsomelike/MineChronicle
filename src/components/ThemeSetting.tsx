import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Segmented } from 'antd';
import {
  applyTheme,
  loadThemePreference,
  saveThemePreference,
  watchSystemTheme,
} from '../lib/theme';
import type { ThemePreference } from '../lib/theme';
import { useResolvedTheme } from '../app/ThemeContext';

const OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}[] = [
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
 *
 * One channel, two painters: every change goes through `choose`/`watchSystemTheme`,
 * which write `data-theme` (the hand-written sheets re-theme instantly) and update
 * the theme context (antd's algorithm re-derives) in the same React commit, so the
 * hand-written surfaces and the antd surfaces never disagree about which theme is
 * showing.
 */
export default function ThemeSetting() {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const { setResolved } = useResolvedTheme();
  // The preference alone cannot say which theme is showing, because 'system'
  // resolves to one of two. This tracks the outcome for the caption.
  const [resolved, setLocalResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = loadThemePreference();
    setPreference(stored);
    setLocalResolved(applyTheme(stored));
  }, []);

  useEffect(() => {
    if (preference !== 'system') return;
    return watchSystemTheme((theme) => {
      applyTheme('system');
      setLocalResolved(theme);
      setResolved(theme);
    });
  }, [preference, setResolved]);

  function choose(next: ThemePreference) {
    setPreference(next);
    saveThemePreference(next);
    const theme = applyTheme(next);
    setLocalResolved(theme);
    setResolved(theme);
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
      <Segmented
        aria-label="外观主题"
        className="theme-choice"
        value={preference}
        onChange={(value) => choose(value as ThemePreference)}
        options={OPTIONS.map((option) => {
          const Icon = option.icon;
          return {
            value: option.value,
            label: (
              <>
                <Icon size={15} aria-hidden="true" />
                {option.label}
              </>
            ),
          };
        })}
      />
    </div>
  );
}
