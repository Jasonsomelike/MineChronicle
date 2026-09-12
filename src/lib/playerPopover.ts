export function playerPopoverPosition(
  anchor: { right: number; bottom: number },
  viewport: { width: number; height: number },
  cssZoom = 1,
) {
  const scale = Number.isFinite(cssZoom) && cssZoom > 0 ? cssZoom : 1;
  const viewportWidth = viewport.width / scale;
  const viewportHeight = viewport.height / scale;
  const width = Math.min(350, Math.max(1, viewportWidth - 36));
  const height = Math.min(380, Math.max(1, viewportHeight - 24));
  return {
    top: Math.max(
      12,
      Math.min(anchor.bottom / scale + 6, viewportHeight - height - 12),
    ),
    left: Math.max(
      18,
      Math.min(anchor.right / scale - width, viewportWidth - width - 18),
    ),
    width,
    height,
  };
}
