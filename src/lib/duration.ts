/** Keep i64 counters as decimal strings across the IPC boundary. */
export function formatPlayTicks(ticks: string): string {
  if (!/^\d+$/.test(ticks))
    throw new Error('Ticks must be a non-negative integer');
  const value = BigInt(ticks);
  if (value > 9223372036854775807n) throw new Error('Ticks exceed i64');
  return formatTickTotal(ticks);
}

function hms(hours: bigint, minutes: bigint, seconds: bigint): string {
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes || hours) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

/** Totals across records can exceed one signed 64-bit counter. */
export function formatTickTotal(ticks: string): string {
  if (!/^\d+$/.test(ticks))
    throw new Error('Ticks must be a non-negative integer');
  const value = BigInt(ticks);
  const seconds = value / 20n;
  if (value > 0n && seconds === 0n) return '<1s';
  return hms(seconds / 3600n, (seconds % 3600n) / 60n, seconds % 60n);
}

/** Compact ranks keep exact seconds in their accessible tooltip. */
export function formatCompactTicks(ticks: string): string {
  const seconds = BigInt(ticks) / 20n;
  if (seconds < 3600n) return formatTickTotal(ticks);
  const hours = seconds / 3600n;
  const minutes = (seconds % 3600n) / 60n;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/**
 * Format a duration already expressed in seconds.
 *
 * Observed sessions are wall-clock measurements, so they are stored in seconds
 * rather than ticks. Converting to ticks here would mean multiplying by 20 only
 * to divide it back out, and would put a value that can legitimately be large
 * through a counter type it does not belong to.
 */
export function formatSeconds(seconds: string): string {
  if (!/^\d+$/.test(seconds)) throw new Error('Seconds must be non-negative');
  const value = BigInt(seconds);
  return hms(value / 3600n, (value % 3600n) / 60n, value % 60n);
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
