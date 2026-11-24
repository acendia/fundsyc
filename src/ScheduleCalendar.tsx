import { useEffect, useState } from "react";
import {
  addCalendarDays, calendarEntries, dateInZone, dayLabel, entryTime, monthDays, moveCalendarMonth, upcomingEntries,
  type CalendarEntry, type CalendarSourceItem,
} from "./schedule-calendar";

type Props = {
  events: CalendarSourceItem[];
  milestones: CalendarSourceItem[];
  tasks: CalendarSourceItem[];
  timeZone: string;
  onOpen: (kind: "events" | "milestones" | "tasks", id: string) => void;
};

const weekdays = [["Mon", "Monday"], ["Tue", "Tuesday"], ["Wed", "Wednesday"], ["Thu", "Thursday"], ["Fri", "Friday"], ["Sat", "Saturday"], ["Sun", "Sunday"]];
const kindNames = { events: "Event", milestones: "Milestone", tasks: "Task deadline" };

export function ScheduleCalendar({ events, milestones, tasks, timeZone, onOpen }: Props) {
  const [now, setNow] = useState(() => new Date());
  const today = dateInZone(now, timeZone);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const days = monthDays(month);
  const entries = calendarEntries(events, milestones, timeZone, tasks);
  const upcoming = upcomingEntries(entries, now, timeZone);
  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", month: "long", year: "numeric",
  }).format(new Date(month + "-01T12:00:00Z"));
  // small chip: a kind colour, the time or kind on top, the title below
  function entryChip(entry: CalendarEntry, date: string) {
    return <button type="button" className="schedule-chip" data-kind={entry.kind} data-completed={entry.completed || undefined}
      aria-label={kindNames[entry.kind] + ": " + entry.title + " · " + entryTime(entry)} onClick={() => onOpen(entry.kind, entry.id)}>
      <small>{entry.date < date ? "Continues · " : ""}{entryTime(entry)}</small>
      <span>{entry.title}</span>
    </button>;
  }
  return <div className="schedule-calendar-layout">
    <section className="schedule-panel" aria-labelledby="schedule-month-heading">
      <div className="schedule-panel-heading">
        <div><h2 id="schedule-month-heading" aria-live="polite">{monthLabel}</h2><p>Times shown in {timeZone}</p></div>
        <div className="schedule-nav" role="group" aria-label="Change month">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(value => moveCalendarMonth(value, -1))}>‹</button>
          <button type="button" onClick={() => { const current = new Date(); setNow(current); setMonth(dateInZone(current, timeZone).slice(0, 7)); }}>Today</button>
          <button type="button" aria-label="Next month" onClick={() => setMonth(value => moveCalendarMonth(value, 1))}>›</button>
        </div>
      </div>
      <div className="schedule-calendar-scroll">
        <table className="schedule-calendar">
          <caption className="schedule-visually-hidden">{monthLabel}</caption>
          <thead><tr>{weekdays.map(([short, full]) => <th scope="col" key={full}><abbr title={full}>{short}</abbr></th>)}</tr></thead>
          <tbody>{Array.from({ length: days.length / 7 }, (_, week) => <tr key={week}>
            {days.slice(week * 7, week * 7 + 7).map(date => <td key={date} data-outside={date.slice(0, 7) !== month || undefined}
              aria-label={dayLabel(date)} aria-current={date === today ? "date" : undefined}>
              <time dateTime={date}>{Number(date.slice(-2))}{date === today && <span className="schedule-today"> Today</span>}</time>
              <ul>{entries.filter(entry => entry.date <= date && entry.lastDate >= date).map(entry => <li key={entry.kind + entry.id}>
                {entryChip(entry, date)}
              </li>)}</ul>
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>
      <p className="schedule-legend" aria-hidden="true"><span data-kind="events">Event</span><span data-kind="milestones">Milestone</span><span data-kind="tasks">Task deadline</span></p>
    </section>
    <section className="schedule-panel schedule-upcoming-panel" aria-labelledby="schedule-upcoming-heading">
      <div className="schedule-panel-heading">
        <div><h2 id="schedule-upcoming-heading">Upcoming</h2><p>Next 14 days · {dayLabel(today)} – {dayLabel(addCalendarDays(today, 13))}</p></div>
      </div>
      {upcoming.length === 0 ? <p className="schedule-empty">No upcoming events, milestones or task deadlines.</p> : <ul className="schedule-upcoming">
        {upcoming.map(entry => {
          const ongoing = entry.startsAt !== null && entry.startsAt <= now.getTime() && (entry.endsAt ?? -Infinity) > now.getTime();
          return <li key={entry.kind + entry.id} data-kind={entry.kind}>
            <p className="schedule-muted"><time dateTime={entry.date}>{dayLabel(entry.date)}</time>{ongoing ? " · In progress" : ""}</p>
            <button type="button" className="schedule-title-link" onClick={() => onOpen(entry.kind, entry.id)}>{entry.title}</button>
            <p className="schedule-muted">{entryTime(entry)} · {entry.partner}</p>
          </li>;
        })}
      </ul>}
    </section>
  </div>;
}
