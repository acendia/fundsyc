export function calendarDayCount(start: string, end: string) {
  return Math.round((Date.parse(end + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / 86_400_000);
}

// include both boundary dates and clip bars to the visible period
export function timelinePosition(start: string, end: string, first: string, last: string) {
  if (end < first || start > last || end < start) return null;
  const visibleStart = start < first ? first : start;
  const visibleEnd = end > last ? last : end;
  const totalDays = calendarDayCount(first, last) + 1;
  return {
    left: calendarDayCount(first, visibleStart) / totalDays * 100,
    width: (calendarDayCount(visibleStart, visibleEnd) + 1) / totalDays * 100,
  };
}
