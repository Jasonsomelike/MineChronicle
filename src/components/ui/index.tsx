import { useId } from 'react';
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from 'react';
import type { ButtonProps } from 'antd';
import { Button, Select, Tabs as AntTabs } from 'antd';

/**
 * The UI adapter: hand-written control signatures, antd implementations.
 *
 * The export signatures are FROZEN - every consumer (WorldLibrary, DataHealth,
 * and the settings cards as they migrate) keeps compiling without changes while
 * the rendering underneath moves to the library. The legacy class names are kept
 * on the rendered elements: they are the hooks the qa-* scripts and the surviving
 * component stylesheets key on (className passthrough is the migration's default
 * policy).
 */

/** Secondary / quiet action. */
export function SecondaryButton({
  children,
  className = '',
  /* The HTML `type` is a signature leftover (type="button"); antd's `type`
     means the visual variant, so the HTML one is consumed and dropped. `color`
     is the same story: an HTML passthrough in the old signature, an antd token
     name now, so it never reaches the library. Destructure-and-drop keeps the
     frozen wide signature; the underscored names are deliberately unused. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type: _htmlType,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  color: _htmlColor,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type="default"
      className={`secondary-button ${className}`.trim()}
      {...(props as ButtonProps)}
      onClick={onClick as MouseEventHandler<HTMLElement>}
    >
      {children}
    </Button>
  );
}

/** Inline text affordance. */
export function TextButton({
  children,
  className = '',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type: _htmlType,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  color: _htmlColor,
  onClick,
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type="text"
      className={`text-button ${className}`.trim()}
      /* The old .text-button sized itself to its text (min-height: 0, padding
         0); antd's control-height chip would space out the inline lists that
         hold these links. Inline styles win the cascade against cssinjs. */
      style={{ height: 'auto', minHeight: 0, padding: 0, ...style }}
      {...(props as ButtonProps)}
      onClick={onClick as MouseEventHandler<HTMLElement>}
    >
      {children}
    </Button>
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
 * ARIA tabs on antd.
 *
 * antd brings the keyboard model the hand-rolled version implemented by hand:
 * roving tabindex, arrow keys that wrap, Home/End, and overflow scrolling for
 * long tab strips. The `id` prop is forwarded, and the tab machinery derives
 * each tab's id as `${id}-tab-${key}` - the exact scheme `tabId` computes, so a
 * caller's external panel keeps pointing at the selected tab with
 * `aria-labelledby`. The tablist itself is antd's `.ant-tabs-nav`; the group
 * `label` is surfaced as a visually hidden line beside the strip because the
 * library offers no aria-label pass-through to the tablist node.
 */
export function Tabs<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  /** Base for the generated tab ids. Defaults to a React-generated unique id. */
  id?: string;
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (next: T) => void;
  /** Kept for signature compatibility; antd owns the panel association. */
  panelId?: string;
}) {
  const generated = useId();
  const base = id ?? generated;
  return (
    <>
      {/* The strip's group name. The library's tablist node is built with fixed
          props, so the label travels as text the reader can still reach
          (`.sr-only` keeps it out of layout, not out of the accessibility
          tree). */}
      <span className="sr-only">{label}</span>
      <AntTabs
        id={base}
        activeKey={value}
        onChange={(key) => onChange(key as T)}
        items={options.map(([key, text]) => ({ key, label: text }))}
        className="health-tabs"
        aria-label={label}
      />
    </>
  );
}

/**
 * Pager: antd arrows and jump select, the hand-written markup's hook set.
 *
 * Deliberately NOT antd's `<Pagination>` primitive: it renders its arrows with a
 * `title` and no `aria-label`, and replaces the count span with an input, while
 * `qa-review-fixes` (on #/worlds) and `qa-flourish-measure` pin `.pagination
 * button` with aria-labels, equal geometry, and the disabled/enabled contrast
 * pair. antd Button/Select composition keeps every one of those hooks and gets
 * its paint from the theme tokens (disabled = the app's measured disabled pair
 * via colorTextDisabled/colorBgContainerDisabled, which antd's own defaults
 * would fail at 4.5:1).
 */
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
  const safePage = Math.min(page, Math.max(pages - 1, 0));
  return (
    <div className="pagination">
      {onJump ? (
        <label>
          跳转到
          <Select
            aria-label="页码"
            value={safePage}
            disabled={pages <= 1}
            onChange={(value) => onJump(Number(value))}
            options={Array.from({ length: pages }, (_, i) => ({
              value: i,
              label: `第 ${i + 1} 页`,
            }))}
          />
        </label>
      ) : null}
      <Button
        title="上一页"
        aria-label="上一页"
        disabled={safePage === 0}
        onClick={onPrev}
      >
        ‹
      </Button>
      <span>
        {safePage + 1} / {pages}
      </span>
      <Button
        title="下一页"
        aria-label="下一页"
        disabled={safePage >= pages - 1}
        onClick={onNext}
      >
        ›
      </Button>
    </div>
  );
}
