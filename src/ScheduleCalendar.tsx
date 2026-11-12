import { useEffect, useState } from "react";
import {
  addCalendarDays, calendarEntries, dateInZone, entryTime, monthDays, moveCalendarMonth, upcomingEntries,
  type CalendarEntry, type CalendarSourceItem,
} from "./schedule-calendar";

type Props = {
  events: CalendarSourceItem[];
  milestones: CalendarSourceItem[];
  timeZone: string;
  onTimeZoneChange: (zone: string) => void;
  onOpen: (kind: "events" | "milestones", id: string) => void;
};

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const zones = ["UTC", ...Intl.supportedValuesOf("timeZone")];

export function ScheduleCalendar({ events, milestones, timeZone, onTimeZoneChange, onOpen }: Props) {
  const [now, setNow] = useState(() => new Date());
  const today = dateInZone(now, timeZone);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const days = monthDays(month);
  const entries = calendarEntries(events, milestones, timeZone);
  const upcoming = upcomingEntries(entries, now, timeZone);
  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", month: "long", year: "numeric",
  }).format(new Date(month + "-01T12:00:00Z"));
  const choices = [...new Set([timeZone, ...zones])].sort();
  function entryButton(entry: CalendarEntry, date: string) {
    return <button type="button" onClick={() => onOpen(entry.kind, entry.id)}>
      {entry.date < date ? "Continues · " : ""}{entryTime(entry)} · {entry.title}
    </button>;
  }
  return <section className="section section-records" aria-label="Schedule calendar and upcoming">
    <p className="schedule-time-zone"><label>Display time zone <select value={timeZone} onChange={event => onTimeZoneChange(event.target.value)}>
      {choices.map(zone => <option value={zone} key={zone}>{zone}</option>)}
    </select></label></p>
    <div className="schedule-calendar-layout">
      <section aria-label="Monthly calendar">
        <p>
          <button type="button" aria-label="Previous month" onClick={() => setMonth(value => moveCalendarMonth(value, -1))}>Previous month</button>{" "}
          <button type="button" onClick={() => { const current = new Date(); setNow(current); setMonth(dateInZone(current, timeZone).slice(0, 7)); }}>Today</button>{" "}
          <button type="button" aria-label="Next month" onClick={() => setMonth(value => moveCalendarMonth(value, 1))}>Next month</button>
        </p>
        <div className="schedule-calendar-scroll">
          <table className="schedule-calendar">
            <caption aria-live="polite">{monthLabel}</caption>
            <thead><tr>{weekdays.map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead>
            <tbody>{Array.from({ length: days.length / 7 }, (_, week) => <tr key={week}>
              {days.slice(week * 7, week * 7 + 7).map(date => <td key={date} data-outside={date.slice(0, 7) !== month || undefined}
                aria-label={date} aria-current={date === today ? "date" : undefined}>
                <time dateTime={date}>{Number(date.slice(-2))}{date === today ? " · Today" : ""}</time>
                <ul>{entries.filter(entry => entry.date <= date && entry.lastDate >= date).map(entry => <li key={entry.kind + entry.id}>
                  {entryButton(entry, date)}
                </li>)}</ul>
              </td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </section>
      <section aria-label="Upcoming schedule items">
        <h2>Upcoming</h2>
        <p>Next 14 days · {today} to {addCalendarDays(today, 13)}</p>
        {upcoming.length === 0 ? <p>No upcoming events or milestones.</p> : <ul className="schedule-upcoming">
          {upcoming.map(entry => {
            const ongoing = entry.startsAt !== null && entry.startsAt <= now.getTime() && (entry.endsAt ?? -Infinity) > now.getTime();
            return <li key={entry.kind + entry.id}>
              <p><time dateTime={entry.date}>{entry.date}</time>{ongoing ? " · In progress" : ""}</p>
              {entryButton(entry, entry.date)}
              <p>{entry.partner}</p>
            </li>;
          })}
        </ul>}
      </section>
    </div>
  </section>;
}
