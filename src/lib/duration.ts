/** Keep i64 counters as decimal strings across the IPC boundary. */
export function formatPlayTicks(ticks: string): string {
  if (!/^\d+$/.test(ticks))
    throw new Error('Ticks must be a non-negative integer');
  const value = BigInt(ticks);
  if (value > 9223372036854775807n) throw new Error('Ticks exceed i64');
  return formatTickTotal(ticks);
}

/** Totals across records can exceed one signed 64-bit counter. */
export function formatTickTotal(ticks: string): string {
  if (!/^\d+$/.test(ticks))
    throw new Error('Ticks must be a non-negative integer');
  const value = BigInt(ticks);
  const seconds = value / 20n;
  const hours = seconds / 3600n;
  const minutes = (seconds % 3600n) / 60n;
  if (value > 0n && seconds === 0n) return '不足 1 秒';
  const parts = [];
  if (hours) parts.push(`${hours} 小时`);
  if (minutes) parts.push(`${minutes} 分钟`);
  if (seconds % 60n || !parts.length) parts.push(`${seconds % 60n} 秒`);
  return parts.join(' ');
}

/** Compact ranks keep exact seconds in their accessible tooltip. */
export function formatCompactTicks(ticks: string): string {
  const full = formatTickTotal(ticks);
  const seconds = BigInt(ticks) / 20n;
  if (seconds < 3600n) return full;
  return `${seconds / 3600n}h${
    (seconds % 3600n) / 60n ? ` ${(seconds % 3600n) / 60n}m` : ''
  }`;
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
  const hours = value / 3600n;
  const minutes = (value % 3600n) / 60n;
  const rest = value % 60n;
  const parts = [];
  if (hours) parts.push(`${hours} 小时`);
  if (minutes) parts.push(`${minutes} 分钟`);
  if (rest || !parts.length) parts.push(`${rest} 秒`);
  return parts.join(' ');
}
