import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INTENT_DELAY_MS,
  LEAVE_GRACE_MS,
  clearLegacyRailPreference,
  createRailController,
} from './rail';
import type { RailController } from './rail';

/** 手动推时的时钟，注入 createRailController 的 setTimeout/clearTimeout 槽位：
 *  计时器不真的等待，advance(ms) 一次性触发所有已到期的回调。 */
function createClock() {
  const scheduled = new Map<number, { fn: () => void; at: number }>();
  const cleared: number[] = [];
  let now = 0;
  let nextId = 1;
  return {
    setTimeout: (fn: () => void, timeout: number) => {
      const id = nextId;
      nextId += 1;
      scheduled.set(id, { fn, at: now + timeout });
      return id;
    },
    clearTimeout: (handle: unknown) => {
      cleared.push(handle as number);
      scheduled.delete(handle as number);
    },
    advance(ms: number) {
      now += ms;
      // 先摘除再触发：回调里若重新定时，不会被同一轮 advance 追认。
      const due = [...scheduled.entries()].filter(([, t]) => t.at <= now);
      for (const [id] of due) scheduled.delete(id);
      for (const [, t] of due) t.fn();
    },
    pending: () => scheduled.size,
    cleared,
  };
}

type Harness = {
  controller: RailController;
  onChange: ReturnType<typeof vi.fn>;
  clock: ReturnType<typeof createClock>;
};

function setup(canOpen = true): Harness {
  const clock = createClock();
  const onChange = vi.fn();
  const controller = createRailController({
    canOpen: () => canOpen,
    onChange,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  return { controller, onChange, clock };
}

/** 指针路径的既定开场：进入 → 推满意图延迟 → onChange(true)。 */
function openViaPointer({ controller, clock }: Harness) {
  controller.pointerEnter();
  clock.advance(INTENT_DELAY_MS);
}

afterEach(() => {
  // 清理用例里 stub 过的 localStorage；其余用例只碰注入的时钟。
  vi.unstubAllGlobals();
});

describe('rail hover state machine', () => {
  describe('进入（指针）', () => {
    it('pointerEnter 满意图延迟后才 onChange(true)', () => {
      const h = setup();
      h.controller.pointerEnter();
      expect(h.onChange).not.toHaveBeenCalled();
      h.clock.advance(INTENT_DELAY_MS - 1);
      expect(h.onChange).not.toHaveBeenCalled();
      h.clock.advance(1);
      expect(h.onChange).toHaveBeenCalledTimes(1);
      expect(h.onChange).toHaveBeenCalledWith(true);
      expect(h.controller.isOpen()).toBe(true);
    });

    it('意图窗口内 pointerLeave 取消打开', () => {
      const h = setup();
      h.controller.pointerEnter();
      h.clock.advance(50);
      h.controller.pointerLeave();
      h.clock.advance(INTENT_DELAY_MS + LEAVE_GRACE_MS);
      expect(h.onChange).not.toHaveBeenCalled();
      expect(h.controller.isOpen()).toBe(false);
      expect(h.clock.pending()).toBe(0);
    });

    it('open 态 pointerEnter 是幂等的，不重挂计时器', () => {
      const h = setup();
      openViaPointer(h);
      h.controller.pointerEnter();
      expect(h.onChange).toHaveBeenCalledTimes(1);
      expect(h.clock.pending()).toBe(0);
    });
  });

  describe('离开与关闭', () => {
    it('open 后 pointerLeave 要推满离开宽限才 onChange(false)', () => {
      const h = setup();
      openViaPointer(h);
      h.controller.pointerLeave();
      // 宽限期内视觉上仍开着，也没有回调。
      expect(h.controller.isOpen()).toBe(true);
      expect(h.onChange).not.toHaveBeenCalledWith(false);
      h.clock.advance(LEAVE_GRACE_MS - 1);
      expect(h.onChange).not.toHaveBeenCalledWith(false);
      h.clock.advance(1);
      expect(h.onChange).toHaveBeenCalledWith(false);
      expect(h.controller.isOpen()).toBe(false);
    });

    it('宽限期内 pointerEnter 取消关闭', () => {
      const h = setup();
      openViaPointer(h);
      h.controller.pointerLeave();
      h.clock.advance(LEAVE_GRACE_MS - 50);
      h.controller.pointerEnter();
      h.clock.advance(LEAVE_GRACE_MS + INTENT_DELAY_MS);
      expect(h.onChange).not.toHaveBeenCalledWith(false);
      expect(h.controller.isOpen()).toBe(true);
    });

    it.each([
      ['navigate', (c: RailController) => c.navigate()],
      ['lightDismiss', (c: RailController) => c.lightDismiss()],
      ['escape', (c: RailController) => c.escape()],
      ['windowBlur', (c: RailController) => c.windowBlur()],
    ] as const)('%s 立即关闭挂起的宽限计时器', (_name, close) => {
      const h = setup();
      openViaPointer(h);
      h.onChange.mockClear();
      h.controller.pointerLeave();
      expect(h.clock.pending()).toBe(1);
      close(h.controller);
      expect(h.onChange).toHaveBeenCalledTimes(1);
      expect(h.onChange).toHaveBeenCalledWith(false);
      expect(h.clock.pending()).toBe(0);
    });

    it('任一关闭事件也取消挂起的意图计时器', () => {
      const h = setup();
      h.controller.pointerEnter();
      expect(h.clock.pending()).toBe(1);
      h.controller.escape();
      h.clock.advance(INTENT_DELAY_MS);
      expect(h.onChange).not.toHaveBeenCalled();
      expect(h.clock.pending()).toBe(0);
    });

    it('close 事件在从未打开时是静默的：不补发 onChange(false)', () => {
      const h = setup();
      h.controller.escape();
      h.controller.windowBlur();
      h.controller.lightDismiss();
      expect(h.onChange).not.toHaveBeenCalled();
    });
  });

  describe('键盘', () => {
    it('focusIn 立即打开，无意图延迟（0ms 未推时钟）', () => {
      const h = setup();
      h.controller.focusIn();
      expect(h.onChange).toHaveBeenCalledTimes(1);
      expect(h.onChange).toHaveBeenCalledWith(true);
      expect(h.controller.isOpen()).toBe(true);
    });

    it('focusIn 顶掉挂起的意图计时器，只开一次', () => {
      const h = setup();
      h.controller.pointerEnter();
      h.controller.focusIn();
      h.clock.advance(INTENT_DELAY_MS);
      expect(h.onChange).toHaveBeenCalledTimes(1);
      expect(h.clock.pending()).toBe(0);
    });

    it('focusOut 立即关闭', () => {
      const h = setup();
      h.controller.focusIn();
      h.onChange.mockClear();
      h.controller.focusOut();
      expect(h.onChange).toHaveBeenCalledTimes(1);
      expect(h.onChange).toHaveBeenCalledWith(false);
    });

    it('focusOut 连宽限一起收掉', () => {
      const h = setup();
      openViaPointer(h);
      h.controller.pointerLeave();
      h.controller.focusOut();
      h.clock.advance(LEAVE_GRACE_MS);
      expect(h.onChange).toHaveBeenCalledWith(false);
      expect(h.clock.pending()).toBe(0);
    });

    it('canOpen()=false 时 open 类事件一律不开', () => {
      const h = setup(false);
      h.controller.pointerEnter();
      h.controller.focusIn();
      h.clock.advance(INTENT_DELAY_MS + LEAVE_GRACE_MS);
      expect(h.onChange).not.toHaveBeenCalled();
      expect(h.controller.isOpen()).toBe(false);
    });
  });

  describe('清理', () => {
    it('clearLegacyRailPreference 删除退役键 minechronicle.rail', () => {
      const removeItem = vi.fn();
      vi.stubGlobal('localStorage', { removeItem });
      clearLegacyRailPreference();
      expect(removeItem).toHaveBeenCalledTimes(1);
      expect(removeItem).toHaveBeenCalledWith('minechronicle.rail');
    });

    it('storage 抛错时不向外抛', () => {
      vi.stubGlobal('localStorage', {
        removeItem: () => {
          throw new Error('Storage disabled');
        },
      });
      expect(() => clearLegacyRailPreference()).not.toThrow();
    });

    it('没有 localStorage 的环境直接跳过', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(() => clearLegacyRailPreference()).not.toThrow();
    });

    it('destroy 取消挂起的计时器且不再回调', () => {
      const h = setup();
      h.controller.pointerEnter();
      h.controller.destroy();
      h.clock.advance(INTENT_DELAY_MS);
      expect(h.onChange).not.toHaveBeenCalled();
      expect(h.clock.pending()).toBe(0);
      expect(h.controller.isOpen()).toBe(false);
    });

    it('destroy 之后旧计时器回调也不会重开（守卫 state）', () => {
      const h = setup();
      openViaPointer(h);
      h.onChange.mockClear();
      h.controller.pointerLeave();
      h.controller.destroy();
      h.clock.advance(LEAVE_GRACE_MS);
      expect(h.onChange).not.toHaveBeenCalled();
    });
  });
});
