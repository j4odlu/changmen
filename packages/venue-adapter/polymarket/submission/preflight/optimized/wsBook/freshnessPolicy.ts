/** [changmen 扩展] Dynamic consumer policy. These are not PM protocol requirements. */
export const DYNAMIC_BOOK_AGES = Object.freeze({ received: 1_000, snapshot: 60_000, metadata: 60_000, source: 5_000, future: 1_000 });
export interface BookTimes { receivedClockAt?: number; snapshotClockAt?: number; sourceAt?: number }
export function withinAge(value: number | undefined, now: number, max: number): boolean {
  return Number.isFinite(value) && now - value! >= 0 && now - value! <= max;
}
export function bookAgeFailure(book: BookTimes, now: number, wall: number): string | undefined {
  if (!withinAge(book.receivedClockAt, now, DYNAMIC_BOOK_AGES.received)
    || !withinAge(book.snapshotClockAt, now, DYNAMIC_BOOK_AGES.snapshot)) return "stale_book";
  if (!Number.isFinite(book.sourceAt) || wall - book.sourceAt! > DYNAMIC_BOOK_AGES.source
    || book.sourceAt! - wall > DYNAMIC_BOOK_AGES.future) return "source_clock_or_age";
  return undefined;
}
