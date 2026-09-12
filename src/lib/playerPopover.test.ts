import { describe, expect, it } from 'vitest';
import { playerPopoverPosition } from './playerPopover';

describe('player popover positioning', () => {
  it('aligns the unscaled popup with its trigger', () => {
    expect(
      playerPopoverPosition(
        { right: 570, bottom: 101 },
        { width: 600, height: 560 },
      ),
    ).toEqual({ left: 220, top: 107, width: 350, height: 380 });
  });

  it.each([0.75, 1, 1.5, 1.75])(
    'keeps all edges visible at CSS zoom %s in the minimum desktop window',
    (zoom) => {
      const position = playerPopoverPosition(
        { right: 580, bottom: 510 },
        { width: 600, height: 560 },
        zoom,
      );
      expect(position.left * zoom).toBeGreaterThanOrEqual(18 * zoom);
      expect(position.top * zoom).toBeGreaterThanOrEqual(12 * zoom);
      expect((position.left + position.width) * zoom).toBeLessThanOrEqual(
        600 - 18 * zoom,
      );
      expect((position.top + position.height) * zoom).toBeLessThanOrEqual(
        560 - 12 * zoom,
      );
    },
  );

  it('uses the native zoom viewport as supplied without an additional scale', () => {
    const position = playerPopoverPosition(
      { right: 310, bottom: 240 },
      { width: 343, height: 320 },
    );
    expect(position).toEqual({ left: 18, top: 12, width: 307, height: 296 });
  });
});
