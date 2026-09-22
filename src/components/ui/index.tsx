import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

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

export function Tabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="health-tabs" role="tablist" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
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
