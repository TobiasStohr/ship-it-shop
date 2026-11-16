/** Today as YYYY-MM-DD in UTC. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/** A bare YYYY-MM-DD date as `to` means the whole day. */
export function endOfDay(date: string): string
export function endOfDay(date?: string): string | undefined
export function endOfDay(date?: string): string | undefined {
  return date ? `${date}T23:59:59.999Z` : undefined
}
