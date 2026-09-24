import {
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

/** Secondary / quiet action. */
export function SecondaryButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`secondary-button ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

/** Inline text affordance. */
export function TextButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`text-button ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  title,
  children,
  className = '',
  ...props
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLElement>) {
  return (
    <section className={`settings-card ${className}`.trim()} {...props}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

/** The id base `Tabs` builds its tab ids from, so the caller's panel can point back at
 *  the tab that is selected with `aria-labelledby`. */
export function tabId(base: string, key: string) {
  return `${base}-tab-${key}`;
}

/**
 * ARIA tabs: the tablist, its roving tabindex and its arrow-key roaming.
 *
 * The panel is the caller's element and is wired in with `panelId`; a tablist whose
 * tabs control nothing tells a screen reader that a panel exists and then does not
 * name it, which is worse than no tabs at all. `id` is the base for the tab ids, so
 * the panel can point back at the selected tab with `aria-labelledby`.
 */
export function Tabs<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  panelId,
}: {
  /** Base for the generated tab ids. Defaults to a React-generated unique id. */
  id?: string;
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (next: T) => void;
  /** The element the selected tab controls; becomes each tab's `aria-controls`. */
  panelId?: string;
}) {
  const generated = useId();
  const base = id ?? generated;
  const list = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={list}
      className="health-tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        const last = options.length - 1;
        const at = options.findIndex(([key]) => key === value);
        const step =
          event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const next =
          step !== 0
            ? (at + step + options.length) % options.length
            : event.key === 'Home'
            ? 0
            : event.key === 'End'
            ? last
            : -1;
        /* The arrows wrap, so the group is a ring and the ends are not dead ends. */
        if (next < 0 || next === at) return;
        event.preventDefault();
        onChange(options[next][0]);
        /* Focus follows the selection. The tablist is a single tab stop, so nothing else
           would move the keyboard cursor onto the tab that just became selected. */
        const tabs =
          list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        tabs?.[next]?.focus();
      }}
    >
      {options.map(([key, text]) => (
        <button
          key={key}
          id={tabId(base, key)}
          type="button"
          role="tab"
          aria-selected={value === key}
          aria-controls={panelId}
          /* One tab stop for the whole tablist, with the arrows moving inside it - the
             behaviour the role promises. Every tab used to be a stop, which made the
             group cost one press per option and left the arrows doing nothing. */
          tabIndex={value === key ? 0 : -1}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pages,
  onPrev,
  onNext,
  onJump,
}: {
  page: number;
  pages: number;
  onPrev: () => void;
  onNext: () => void;
  onJump?: (page: number) => void;
}) {
  return (
    <div className="pagination">
      {onJump ? (
        <label>
          跳转到
          <select
            aria-label="页码"
            value={page}
            onChange={(e) => onJump(Number(e.target.value))}
          >
            {Array.from({ length: pages }, (_, i) => (
              <option value={i} key={i}>
                第 {i + 1} 页
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button
        type="button"
        title="上一页"
        aria-label="上一页"
        disabled={page === 0}
        onClick={onPrev}
      >
        ‹
      </button>
      <span>
        {page + 1} / {pages}
      </span>
      <button
        type="button"
        title="下一页"
        aria-label="下一页"
        disabled={page >= pages - 1}
        onClick={onNext}
      >
        ›
      </button>
    </div>
  );
}
