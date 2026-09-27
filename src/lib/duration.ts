/** Keep i64 counters as decimal strings across the IPC boundary. */
export function formatPlayTicks(ticks: string): string {
  if (!/^\d+$/.test(ticks))
    throw new Error('Ticks must be a non-negative integer');
  const value = BigInt(ticks);
  if (value > 9223372036854775807n) throw new Error('Ticks exceed i64');
  return formatTickTotal(ticks);
}

/** What every exit prints where there is no reading at all. */
export const UNKNOWN_DURATION = '—';

/** A positive count under one second. Not `0 秒`, which would claim the counter is
 *  empty when it is not - the same distinction the missing-world rows make. */
const SUB_SECOND = '不足 1 秒';

const DAY = 86400n;
const HOUR = 3600n;
const MINUTE = 60n;

/**
 * The one duration readout: the largest non-zero unit starts, and every reading
 * runs down to the second.
 *
 * The app used to print the same quantity three ways - `1449h 39m 43s` in the hero,
 * `1449h 5m` and `34m 10s` in the ruler and ranking, a bare `0` on the ruler's first
 * graduation - and a reader who sees one number written three ways reads it as three
 * numbers. There is one wording now and every surface uses it.
 *
 * Seconds are always printed (user requirement: 精确到秒 - a reading of `60 天 9
 * 小时` could hide up to 59 minutes of play inside it, and two worlds one minute
 * apart were indistinguishable). Zero units between the start and the seconds are
 * printed rather than skipped, so `2 小时 0 分 3 秒` says exactly where the time
 * sits instead of implying continuity. Units are the interface's own language
 * (中文), not `h/m/s`.
 */
function humanDuration(seconds: bigint): string {
  const days = seconds / DAY;
  const hours = (seconds % DAY) / HOUR;
  const minutes = (seconds % HOUR) / MINUTE;
  const rest = seconds % MINUTE;
  if (days) return `${days} 天 ${hours} 小时 ${minutes} 分 ${rest} 秒`;
  if (hours) return `${hours} 小时 ${minutes} 分 ${rest} 秒`;
  if (minutes) return `${minutes} 分 ${rest} 秒`;
  return `${rest} 秒`;
}

const ticksToSeconds = (ticks: string): { value: bigint; seconds: bigint } => {
  if (!/^\d+$/.test(ticks))
    throw new Error('Ticks must be a non-negative integer');
  const value = BigInt(ticks);
  return { value, seconds: value / 20n };
};

/**
 * Totals across records can exceed one signed 64-bit counter.
 *
 * One of the two tick exits, and both of them print exactly this string - see
 * `formatCompactTicks`.
 */
export function formatTickTotal(ticks: string): string {
  const { value, seconds } = ticksToSeconds(ticks);
  if (value > 0n && seconds === 0n) return SUB_SECOND;
  return humanDuration(seconds);
}

/**
 * The compact tick exit.
 *
 * It used to print a second, coarser reading (`1449h 5m` where the hero said
 * `1449h 39m 43s`), which is how the same world came to have two different values on
 * one screen. It is an alias now: one implementation, one string, whatever a caller
 * asks for. The name is kept because 30-odd call sites read better with it - a
 * ruler row and a hero figure are the same measurement but not the same sentence -
 * and because a rename would have touched every one of them for no change in output.
 */
export function formatCompactTicks(ticks: string): string {
  return formatTickTotal(ticks);
}

/**
 * Format a duration already expressed in seconds.
 *
 * Observed sessions are wall-clock measurements, so they are stored in seconds
 * rather than ticks. Converting to ticks here would mean multiplying by 20 only
 * to divide it back out, and would put a value that can legitimately be large
 * through a counter type it does not belong to. The wording is the same one
 * function as the tick exits, so time reads the same on every page.
 */
export function formatSeconds(seconds: string): string {
  if (!/^\d+$/.test(seconds)) throw new Error('Seconds must be non-negative');
  return humanDuration(BigInt(seconds));
}

/**
 * The group-total exit, for a value the archive may leave empty.
 *
 * `ObservationGroup.seconds` is empty - not `0` - when no session in the group
 * had a measurable duration: every run ended unobserved or lacks a baseline.
 * That is an unknown reading, and `formatSeconds` rightly refuses to guess at
 * it, so the empty reading prints the same `—` as every other unknown. Before
 * this exit existed the empty string reached the strict formatter and took the
 * whole observation page down with `Seconds must be non-negative`.
 */
export function formatGroupSeconds(seconds: string): string {
  return seconds ? formatSeconds(seconds) : UNKNOWN_DURATION;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Stored UTC form -> the local wall-clock form `<input type="datetime-local">`
 * expects, and back.
 *
 * These two must be exact inverses. The archive stores UTC while the input shows
 * local time, so a round trip that loses the offset shifts an entered end time
 * by the timezone difference - eight hours here, which is small enough to look
 * plausible and go unnoticed. Both directions are tested.
 */
export function utcToLocalInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds(),
    )}`
  );
}

/**
 * Local input value -> the stored UTC form.
 *
 * A bare `YYYY-MM-DDTHH:MM:SS` is interpreted as local time by `new Date`, which
 * is exactly what the field means to the person typing it.
 */
export function localInputToUtc(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // The stored form has second precision; milliseconds are dropped rather than
  // rounded, matching how observed timestamps are written.
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
