import test from "node:test";
import assert from "node:assert/strict";
import { buildScheduleIcs } from "./schedule-ics.ts";

const now = new Date("2027-05-01T10:00:00Z");

test("timed events export utc instants and omit dtend when ends_at is null", () => {
  const ics = buildScheduleIcs({
    events: [
      {
        id: "e1", title: "Kickoff", partner_name: "Athens", organizer_name: "Elena",
        event_type: "meeting", event_date: "2027-05-17", all_day: false,
        starts_at: "2027-05-17T06:00:00Z", ends_at: "2027-05-17T07:30:00Z",
        notes: "Bring slides", status: "active",
      },
      {
        id: "e2", title: "Check-in", partner_name: "Athens",
        event_type: "reminder", event_date: "2027-05-18", all_day: false,
        starts_at: "2027-05-18T09:00:00Z", ends_at: null, status: "active",
      },
    ],
    workstreams: [],
    milestones: [],
    tasks: [],
  }, now);

  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.includes("UID:event-e1@fundsyc\r\n"));
  assert.ok(ics.includes("DTSTAMP:20270501T100000Z\r\n"));
  assert.ok(ics.includes("DTSTART:20270517T060000Z\r\n"));
  assert.ok(ics.includes("DTEND:20270517T073000Z\r\n"));
  assert.ok(ics.includes("SUMMARY:Kickoff\r\n"));

  const second = ics.split("BEGIN:VEVENT")[2];
  assert.ok(second.includes("DTSTART:20270518T090000Z\r\n"));
  assert.equal(second.includes("DTEND:"), false);
});

test("all-day events, workstreams, milestones and tasks use exclusive value=date ranges", () => {
  const ics = buildScheduleIcs({
    events: [
      { id: "e1", title: "Submission day", partner_name: "Athens", event_date: "2028-02-28", all_day: true, status: "active" },
    ],
    workstreams: [
      { id: "w1", title: "WP1", partner_name: "Athens", start_date: "2028-02-28", end_date: "2028-02-29", progress: "in_progress", status: "active" },
    ],
    milestones: [
      { id: "m1", title: "Draft freeze", partner_name: "Berlin", due_date: "2027-12-31", progress: "planned", status: "active" },
    ],
    tasks: [
      { id: "t1", title: "Budget table", partner_name: "Berlin", assignee_name: "Nikos", due_date: "2027-05-20", progress: "todo", status: "active" },
    ],
  }, now);

  assert.ok(ics.includes("DTSTART;VALUE=DATE:20280228\r\nDTEND;VALUE=DATE:20280229\r\nSUMMARY:Submission day\r\n"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20280228\r\nDTEND;VALUE=DATE:20280301\r\nSUMMARY:Workstream: WP1\r\n"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20271231\r\nDTEND;VALUE=DATE:20280101\r\nSUMMARY:Milestone: Draft freeze\r\n"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20270520\r\nDTEND;VALUE=DATE:20270521\r\nSUMMARY:Task due: Budget table\r\n"));
});

test("removed items and tasks without due dates are excluded", () => {
  const ics = buildScheduleIcs({
    events: [{ id: "e1", title: "Removed", partner_name: "Athens", event_date: "2027-05-17", all_day: true, status: "removed" }],
    workstreams: [{ id: "w1", title: "Removed", partner_name: "Athens", start_date: "2027-05-17", end_date: "2027-05-18", status: "removed" }],
    milestones: [{ id: "m1", title: "Removed", partner_name: "Athens", due_date: "2027-05-17", status: "removed" }],
    tasks: [
      { id: "t1", title: "Removed", partner_name: "Athens", due_date: "2027-05-17", status: "removed" },
      { id: "t2", title: "No date", partner_name: "Athens", due_date: null, status: "active" },
    ],
  }, now);

  assert.equal(ics.includes("BEGIN:VEVENT"), false);
});

test("text escaping and 75-octet line folding preserve utf-8 characters", () => {
  const longTitle = "Review, annex; final\\check " + "αβγδεζηθικλμνξοπρστυφχψω".repeat(3);
  const ics = buildScheduleIcs({
    events: [
      {
        id: "e1", title: longTitle, partner_name: "Athens",
        event_date: "2027-05-17", all_day: true, notes: "Line 1\nLine 2; a, b\\c", status: "active",
      },
    ],
    workstreams: [],
    milestones: [],
    tasks: [],
  }, now);

  const encoder = new TextEncoder();
  for (const line of ics.split("\r\n")) {
    assert.ok(encoder.encode(line).length <= 75, "line exceeded 75 octets: " + line);
  }
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("SUMMARY:Review\\, annex\\; final\\\\check "));
  assert.ok(unfolded.includes("Line 1\\nLine 2\\; a\\, b\\\\c"));
});
