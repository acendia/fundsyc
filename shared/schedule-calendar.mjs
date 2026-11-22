export function dateInZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const value = type => parts.find(part => part.type === type).value;
  return value("year") + "-" + value("month") + "-" + value("day");
}

function timeInZone(instant, timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(instant);
}

// do calendar arithmetic in utc so clock changes do not shift date-only values
export function addCalendarDays(date, days) {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function moveCalendarMonth(month, offset) {
  const date = new Date(month + "-01T12:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function monthDays(month) {
  const first = month + "-01";
  const weekday = new Date(first + "T12:00:00Z").getUTCDay();
  const start = addCalendarDays(first, -((weekday + 6) % 7));
  const last = addCalendarDays(moveCalendarMonth(month, 1) + "-01", -1);
  const days = [];
  let date = start;
  while (date <= last || days.length % 7 !== 0) {
    days.push(date);
    date = addCalendarDays(date, 1);
  }
  return days;
}

export function calendarEntries(events, milestones, timeZone, tasks = []) {
  const entries = [];
  for (const event of events) {
    if (event.status === "removed" || !event.event_date) continue;
    const start = !event.all_day && event.starts_at ? new Date(event.starts_at) : null;
    const end = start && event.ends_at ? new Date(event.ends_at) : null;
    const date = start ? dateInZone(start, timeZone) : event.event_date;
    entries.push({
      id: event.id, kind: "events", title: event.title, partner: event.partner_name,
      date, lastDate: end ? dateInZone(new Date(end.getTime() - 1), timeZone) : date,
      time: start ? timeInZone(start, timeZone) : null,
      endTime: end ? timeInZone(end, timeZone) : null,
      endDate: end ? dateInZone(end, timeZone) : null,
      startsAt: start?.getTime() ?? null, endsAt: end?.getTime() ?? null, completed: false,
    });
  }
  for (const [items, kind] of [[milestones, "milestones"], [tasks, "tasks"]]) {
    for (const item of items) {
      if (item.status === "removed" || !item.due_date) continue;
      entries.push({
        id: item.id, kind, title: item.title, partner: item.partner_name,
        date: item.due_date, lastDate: item.due_date, time: null, endTime: null, endDate: null,
        startsAt: null, endsAt: null, completed: item.progress === "completed",
      });
    }
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date)
    || (a.startsAt ?? -Infinity) - (b.startsAt ?? -Infinity)
    || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export function upcomingEntries(entries, now, timeZone) {
  const today = dateInZone(now, timeZone);
  const lastDay = addCalendarDays(today, 13);
  return entries.filter(entry => {
    if (entry.completed) return false;
    if (entry.startsAt === null) return entry.date >= today && entry.date <= lastDay;
    return entry.date <= lastDay && (entry.startsAt >= now.getTime() || (entry.endsAt ?? -Infinity) > now.getTime());
  });
}

export function entryTime(entry) {
  if (entry.kind === "milestones") return "Milestone" + (entry.completed ? " · Completed" : "");
  if (entry.kind === "tasks") return "Task due" + (entry.completed ? " · Completed" : "");
  if (!entry.time) return "All day";
  const end = entry.endTime
    ? "–" + (entry.endDate !== entry.date ? entry.endDate + " " : "") + entry.endTime
    : "";
  return entry.time + end;
}
