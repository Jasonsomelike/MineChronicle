import gsap from 'gsap';

export function prefersReducedMotion(
  media?: Pick<MediaQueryList, 'matches'>,
): boolean {
  if (media) return media.matches;
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function newlyDiscoveredIds(
  previous: readonly string[],
  next: readonly string[],
): string[] {
  const before = new Set(previous);
  return next.filter((id) => !before.has(id));
}

type QueryRoot = {
  querySelector: (selectors: string) => Element | null;
};

function defaultRoot(): QueryRoot | null {
  if (typeof document === 'undefined') return null;
  return document;
}

function escapeId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/["\\]/g, '\\$&');
}

export function animateDiscoveredStatIcons(
  ids: readonly string[],
  root: QueryRoot | null = defaultRoot(),
  media?: Pick<MediaQueryList, 'matches'>,
): gsap.core.Timeline | null {
  if (!ids.length || prefersReducedMotion(media) || !root) return null;
  const nodes = ids
    .map((id) => root.querySelector(`[data-stat-id="${escapeId(id)}"] .stat-sprite`))
    .filter((node): node is HTMLElement => Boolean(node && 'style' in node));
  if (!nodes.length) return null;
  return gsap
    .timeline()
    .fromTo(
      nodes,
      { opacity: 0, y: 6, scale: 0.92 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.32,
        stagger: 0.025,
        ease: 'power2.out',
        overwrite: true,
      },
    );
}
