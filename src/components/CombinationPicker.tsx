import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { playerPopoverPosition } from '../lib/playerPopover';
import {
  invertSelection,
  selectedFirst,
  toggleSelection,
} from '../lib/selection';
import type { Combination } from '../lib/selection';
import { usePageActive } from './SessionPage';

export interface Choice {
  id: string;
  label: string;
  detail?: string;
}
export default function CombinationPicker({
  label,
  options,
  value,
  onChange,
  shortcut,
  pinned,
  stableWhileOpen = false,
}: {
  label: string;
  options: Choice[];
  value: Combination;
  onChange: (value: Combination) => void;
  shortcut?: { label: string; ids: string[] };
  pinned?: ReactNode;
  stableWhileOpen?: boolean;
}) {
  const active = usePageActive();
  const [openingOrder, setOpeningOrder] = useState<string[]>([]);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 350,
    height: 380,
  });
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const ids = options.map((o) => o.id);
  const selected = value ?? ids;
  const names = selected.map(
    (id) => options.find((o) => o.id === id)?.label ?? id,
  );
  const title =
    value === null
      ? `全部${label}（${options.length}）`
      : !value.length
      ? `未选择${label}`
      : `${names.slice(0, 2).join(' + ')}${
          names.length > 2 ? ` 等 ${names.length} 项` : ''
        }`;
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !trigger.current?.contains(e.target as Node) &&
        !panel.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    window.addEventListener('minechronicle:zoom-change', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
      window.removeEventListener('minechronicle:zoom-change', close);
    };
  }, [open]);
  const finish = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const ordered =
    stableWhileOpen && open
      ? [...options].sort((a, b) => {
          const rank = (id: string) => {
            const n = openingOrder.indexOf(id);
            return n < 0 ? openingOrder.length : n;
          };
          return rank(a.id) - rank(b.id);
        })
      : selectedFirst(options, value);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  const filtered = ordered.filter((o) =>
    `${o.label} ${o.detail ?? ''} ${o.id}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="player-picker combination-picker">
      <span className="picker-label">
        {label}
        {value && value.length > 1 ? ` · ${value.length} 项组合` : ''}
      </span>
      <button
        type="button"
        ref={trigger}
        className="player-trigger"
        title={names.join(' + ')}
        aria-label={`${label}：${title}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open)
            setOpeningOrder(selectedFirst(options, value).map((o) => o.id));
          const rect = trigger.current?.getBoundingClientRect();
          const zoom =
            Number(
              getComputedStyle(document.documentElement).getPropertyValue(
                '--ui-css-zoom',
              ),
            ) ||
            Number(document.documentElement.style.zoom) ||
            1;
          if (rect)
            setPosition(
              playerPopoverPosition(
                rect,
                { width: innerWidth, height: innerHeight },
                zoom,
              ),
            );
          setOpen(!open);
        }}
      >
        <span>{title}</span>
        <ChevronDown size={15} />
      </button>
      {open && active
        ? createPortal(
            <div className="scan-panel">
              <div
                ref={panel}
                className="player-popover player-picker combination-popover"
                style={position}
                role="dialog"
                aria-label={`选择${label}`}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') finish();
                }}
              >
                <div className="picker-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onChange(null)}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onChange(invertSelection(value, ids))}
                  >
                    反选
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onChange([])}
                  >
                    清空
                  </button>
                  {shortcut ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onChange(shortcut.ids)}
                    >
                      {shortcut.label}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="icon-button"
                    title="完成选择"
                    aria-label="完成选择"
                    onClick={finish}
                  >
                    <Check size={16} />
                  </button>
                </div>
                <label className="picker-search">
                  <Search size={14} />
                  <input
                    autoFocus
                    value={query}
                    aria-label={`搜索${label}`}
                    placeholder={`搜索${label}名称或路径`}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <div className="picker-options">
                  {pinned}
                  {filtered.map((option) => (
                    <label
                      key={option.id}
                      className={
                        selected.includes(option.id) ? 'choice-selected' : ''
                      }
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(option.id)}
                        onChange={() =>
                          onChange(toggleSelection(value, option.id, ids))
                        }
                      />
                      <span>
                        {option.label}
                        {option.detail ? <small>{option.detail}</small> : null}
                      </span>
                    </label>
                  ))}
                  {!filtered.length ? (
                    <p className="picker-empty">没有匹配项</p>
                  ) : null}
                </div>
                <div className="picker-summary" aria-live="polite">
                  已选 {selected.length} / {options.length} ·{' '}
                  {stableWhileOpen ? '下次打开时已选置顶' : '已选置顶'}
                  {query ? ' · 全选/反选作用于完整列表' : ''}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
