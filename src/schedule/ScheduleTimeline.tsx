import { useState } from "react";
import { addCalendarDays, dayLabel, moveCalendarMonth } from "./schedule-calendar";
import { calendarDayCount, timelinePosition } from "./schedule-timeline";
import { scheduleProgressOptions } from "../models";

type TimelineItem = {
  id: string; title: string; partner_name: string; progress?: string;
  start_date?: string; end_date?: string; due_date?: string;
};
type Props = {
  workstreams: TimelineItem[];
  milestones: TimelineItem[];
  today: string;
  onOpen: (kind: "workstreams" | "milestones", id: string) => void;
};
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", day: "numeric", month: "short",
}).format(new Date(date + "T12:00:00Z"));

export function ScheduleTimeline({ workstreams, milestones, today, onOpen }: Props) {
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const first = month + "-01";
  const last = addCalendarDays(moveCalendarMonth(month, 3) + "-01", -1);
  const totalDays = calendarDayCount(first, last) + 1;
  const ticks: string[] = [];
  const weekday = new Date(first + "T12:00:00Z").getUTCDay();
  let monday = addCalendarDays(first, (8 - weekday) % 7);
  while (monday <= last) {
    ticks.push(monday);
    monday = addCalendarDays(monday, 7);
  }
  const rows = [
    ...workstreams.filter(item => item.start_date && item.end_date).map(item => ({
      item, kind: "workstreams" as const, start: item.start_date!, end: item.end_date!,
    })),
    ...milestones.filter(item => item.due_date).map(item => ({
      item, kind: "milestones" as const, start: item.due_date!, end: item.due_date!,
    })),
  ].filter(row => timelinePosition(row.start, row.end, first, last))
    .sort((a, b) => a.start.localeCompare(b.start) || a.item.title.localeCompare(b.item.title) || a.item.id.localeCompare(b.item.id));

  return <section className="schedule-panel" aria-labelledby="schedule-timeline-heading">
    <div className="schedule-panel-heading">
      <div><h2 id="schedule-timeline-heading">Proposal timeline</h2>
        <p aria-live="polite">{dayLabel(first)} – {dayLabel(last)} · Week markers are Mondays</p></div>
      <div className="schedule-nav" role="group" aria-label="Change timeline period">
        <button type="button" aria-label="Previous 3 months" onClick={() => setMonth(value => moveCalendarMonth(value, -3))}>‹</button>
        <button type="button" onClick={() => setMonth(today.slice(0, 7))}>Current period</button>
        <button type="button" aria-label="Next 3 months" onClick={() => setMonth(value => moveCalendarMonth(value, 3))}>›</button>
      </div>
    </div>
    {rows.length === 0 ? <p className="schedule-empty">No workstreams or milestones in this period.</p> : <div className="schedule-table-scroll" tabIndex={0} role="region" aria-label="Timeline table">
      <table className="schedule-timeline">
        <thead><tr><th scope="col">Workstream / milestone</th><th scope="col">Partner</th><th scope="col">Progress</th><th scope="col">Dates</th>
          <th scope="col" className="schedule-timeline-scale"><div className="schedule-timeline-ticks" aria-label="Timeline week markers">
            {/* every other monday gets a label so they never overlap, every monday keeps its line */}
            {ticks.filter((_, index) => index % 2 === 0).map(date => <span key={date} style={{ left: calendarDayCount(first, date) / totalDays * 100 + "%" }}>{dateLabel(date)}</span>)}
          </div></th>
        </tr></thead>
        <tbody>{rows.map(({ item, kind, start, end }) => {
          const position = timelinePosition(start, end, first, last)!;
          const progress = scheduleProgressOptions.find(option => option.value === item.progress)?.label ?? item.progress;
          return <tr key={kind + item.id}>
            <th scope="row"><button type="button" className="schedule-title-link" onClick={() => onOpen(kind, item.id)}>{item.title}</button><small>{kind === "milestones" ? "Milestone" : "Workstream"}</small></th>
            <td>{item.partner_name}</td><td><span className="schedule-badge" data-progress={item.progress}>{progress}</span></td>
            <td className="schedule-nowrap">{kind === "milestones" ? dayLabel(start) : dayLabel(start) + " – " + dayLabel(end)}</td>
            <td><div className="schedule-timeline-track" aria-label={item.title + " · " + start + " to " + end}>
              {ticks.map(date => <span className="schedule-timeline-tick" key={date} style={{ left: calendarDayCount(first, date) / totalDays * 100 + "%" }} />)}
              <button type="button" aria-label={"Open " + item.title} title={item.title + " · " + start + " to " + end}
                className={kind === "milestones" ? "schedule-timeline-milestone" : "schedule-timeline-bar"}
                data-progress={item.progress} onClick={() => onOpen(kind, item.id)}
                style={kind === "milestones" ? { left: position.left + position.width / 2 + "%" } : { left: position.left + "%", width: position.width + "%" }}>
                {kind === "milestones" ? "◆" : <span className="schedule-timeline-bar-text">{item.title}</span>}
              </button>
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
  </section>;
}
