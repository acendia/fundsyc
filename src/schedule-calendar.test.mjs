import test from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarDays, calendarEntries, dateInZone, entryTime, monthDays, moveCalendarMonth, upcomingEntries,
} from "./schedule-calendar.ts";

const event = {
  id: "meeting", title: "Meeting", partner_name: "Athens", status: "active",
  event_date: "2027-05-17", all_day: false,
  starts_at: "2027-05-17T06:00:00Z", ends_at: "2027-05-17T07:00:00Z",
};
const allDay = { ...event, id: "deadline", all_day: true, starts_at: null, ends_at: null };
const milestone = { id: "submission", title: "Submit", partner_name: "Athens", due_date: "2027-05-17", progress: "planned" };

test("date-only entries stay fixed while timed events move to the viewer's day", () => {
  const athens = calendarEntries([event, allDay], [milestone], "Europe/Athens");
  const la = calendarEntries([event, allDay], [milestone], "America/Los_Angeles");
  assert.equal(athens.find(e => e.id === "meeting").time, "09:00");
  assert.equal(la.find(e => e.id === "meeting").date, "2027-05-16");
  assert.equal(la.find(e => e.id === "meeting").time, "23:00");
  for (const id of ["deadline", "submission"]) assert.equal(la.find(e => e.id === id).date, "2027-05-17");
});

test("month grids start Monday and contain every day, including leap days", () => {
  for (const month of ["2027-05", "2027-08", "2028-02", "2021-02", "2026-12"]) {
    const days = monthDays(month);
    assert.equal(new Date(days[0] + "T12:00Z").getUTCDay(), 1);
    assert.equal(days.length % 7, 0);
    assert.equal(days.includes(month + "-01"), true);
    assert.equal(new Set(days).size, days.length);
  }
  assert.ok(monthDays("2028-02").includes("2028-02-29"));
  assert.equal(monthDays("2021-02").length, 28);
  assert.equal(monthDays("2027-05").length, 42);
  assert.equal(moveCalendarMonth("2026-12", 1), "2027-01");
  assert.equal(moveCalendarMonth("2027-01", -1), "2026-12");
});

test("upcoming includes today through day thirteen, with elapsed times and completed milestones excluded", () => {
  const now = new Date("2027-05-17T06:30:00Z");
  const events = [
    event,
    { ...event, id: "ended", starts_at: "2027-05-17T05:00Z", ends_at: "2027-05-17T06:00Z" },
    { ...event, id: "no-end-past", starts_at: "2027-05-17T05:00Z", ends_at: null },
    { ...event, id: "future", starts_at: "2027-05-17T08:00Z", ends_at: null },
    allDay, { ...allDay, id: "last", event_date: "2027-05-30" },
    { ...allDay, id: "outside", event_date: "2027-05-31" },
    { ...allDay, id: "yesterday", event_date: "2027-05-16" },
  ];
  const milestones = [milestone, { ...milestone, id: "approved", progress: "completed" }];
  const entries = calendarEntries(events, milestones, "Europe/Athens");
  assert.ok(entries.some(e => e.id === "approved"));
  assert.deepEqual(new Set(upcomingEntries(entries, now, "Europe/Athens").map(e => e.id)),
    new Set(["meeting", "future", "deadline", "last", "submission"]));
});

test("ongoing events cross midnight and midnight endings do not occupy an extra day", () => {
  const entries = calendarEntries([
    { ...event, id: "cross", starts_at: "2027-05-17T06:30Z", ends_at: "2027-05-17T08:30Z" },
    { ...event, id: "midnight-end", starts_at: "2027-05-17T06:30Z", ends_at: "2027-05-17T07:00Z" },
  ], [], "America/Los_Angeles");
  const cross = entries.find(e => e.id === "cross");
  assert.equal(cross.date, "2027-05-16");
  assert.equal(cross.lastDate, "2027-05-17");
  assert.equal(entryTime(cross), "23:30–2027-05-17 01:30");
  assert.equal(entries.find(e => e.id === "midnight-end").lastDate, "2027-05-16");
  assert.deepEqual(upcomingEntries(entries, new Date("2027-05-17T07:30Z"), "America/Los_Angeles").map(e => e.id), ["cross"]);
});

test("clock changes preserve instant ordering and fourteen calendar dates", () => {
  const entries = calendarEntries([
    { ...event, id: "later", event_date: "2027-10-31", starts_at: "2027-10-31T01:30Z", ends_at: null },
    { ...event, id: "earlier", event_date: "2027-10-31", starts_at: "2027-10-31T00:30Z", ends_at: null },
  ], [], "Europe/Athens");
  assert.deepEqual(entries.map(e => e.id), ["earlier", "later"]);
  assert.deepEqual(entries.map(e => e.time), ["03:30", "03:30"]);
  assert.deepEqual(upcomingEntries(entries, new Date("2027-10-31T01:00Z"), "Europe/Athens").map(e => e.id), ["later"]);
  assert.equal(addCalendarDays("2027-03-22", 13), "2027-04-04");
  assert.equal(dateInZone(new Date("2027-03-28T21:30Z"), "Europe/Athens"), "2027-03-29");
});

test("removed items are excluded and all-day entries sort before timed entries", () => {
  const entries = calendarEntries([event, allDay, { ...event, id: "removed", status: "removed" }],
    [{ ...milestone, status: "removed" }], "Europe/Athens");
  assert.deepEqual(entries.map(e => e.id), ["deadline", "meeting"]);
});

test("task deadlines stay date-only, follow edits, and completed tasks leave Upcoming", () => {
  const task = { id: "task", title: "Draft annex", partner_name: "Athens", due_date: "2027-05-17", progress: "todo", status: "active" };
  const now = new Date("2027-05-17T12:00Z");
  const entries = calendarEntries([], [], "America/Los_Angeles", [task]);
  assert.equal(entries[0].kind, "tasks");
  assert.equal(entries[0].date, task.due_date);
  assert.equal(entryTime(entries[0]), "Task due");
  assert.equal(upcomingEntries(entries, now, "America/Los_Angeles").length, 1);
  const completed = calendarEntries([], [], "UTC", [{ ...task, progress: "completed" }]);
  assert.equal(completed.length, 1);
  assert.equal(upcomingEntries(completed, now, "UTC").length, 0);
  assert.equal(calendarEntries([], [], "UTC", [{ ...task, status: "removed" }, { ...task, due_date: null }]).length, 0);
  assert.equal(calendarEntries([], [], "UTC", [{ ...task, due_date: "2027-05-18" }])[0].date, "2027-05-18");
});
