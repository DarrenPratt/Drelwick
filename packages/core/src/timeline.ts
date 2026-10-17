/** Dates are display labels, never an implicit chronology. */
export function compareTimelineEvents(
  a: { id: string; sequence?: number | undefined },
  b: { id: string; sequence?: number | undefined },
): number {
  if (a.sequence === undefined && b.sequence !== undefined) return 1;
  if (a.sequence !== undefined && b.sequence === undefined) return -1;
  if (
    a.sequence !== undefined &&
    b.sequence !== undefined &&
    a.sequence !== b.sequence
  )
    return a.sequence < b.sequence ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
