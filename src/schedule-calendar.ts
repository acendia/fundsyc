// the overview and calendar share the same date, time zone and upcoming rules
export {
  dateInZone, addCalendarDays, moveCalendarMonth, monthDays, calendarEntries, upcomingEntries, entryTime,
  type CalendarSourceItem, type CalendarEntry,
} from "../shared/schedule-calendar.mjs";

// readable calendar day, built at utc noon so it never shifts a day
const dayFormat = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
export const dayLabel = (date: string) => dayFormat.format(new Date(date + "T12:00:00Z"));
