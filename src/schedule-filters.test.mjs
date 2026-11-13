import test from "node:test";
import assert from "node:assert/strict";
import { emptyScheduleFilters, matchesScheduleFilters } from "./schedule-filters.ts";
const meeting = { title: "Budget meeting", partner_id: "athens", organizer_user_id: "maria", event_type: "meeting" };
const workstream = { title: "Budget preparation", lead_partner_id: "athens", progress: "in_progress" };
const task = { title: "Budget draft", partner_id: "athens", progress: "in_progress", due_date: "2027-05-01" };
const matches = (item, kind, filters = {}) => matchesScheduleFilters(item, kind, { ...emptyScheduleFilters, ...filters });

test("title matching trims whitespace, ignores case and combines filters", () => {
  assert.equal(matches(meeting, "events", { title: " BUDGET ", type: "meeting", partner: "athens", organizer: "maria" }), true);
  assert.equal(matches(meeting, "events", { title: "Budget", partner: "ucla" }), false);
  assert.equal(matches(meeting, "events", { title: "Missing" }), false);
  assert.equal(matches(meeting, "events", { title: "   " }), true);
});
test("types distinguish event subtypes, timeline items and task deadlines", () => {
  assert.equal(matches(meeting, "events", { type: "events" }), true);
  assert.equal(matches(meeting, "events", { type: "reminder" }), false);
  assert.equal(matches(workstream, "workstreams", { type: "workstreams" }), true);
  assert.equal(matches(task, "tasks", { type: "tasks" }), true);
  assert.equal(matches(task, "tasks", { type: "workstreams" }), false);
});
test("organizer applies to events and progress distinguishes task and timeline vocabularies", () => {
  assert.equal(matches(workstream, "workstreams", { organizer: "maria" }), false);
  assert.equal(matches(meeting, "events", { progress: "timeline:planned" }), false);
  assert.equal(matches(workstream, "workstreams", { progress: "timeline:in_progress" }), true);
  assert.equal(matches(task, "tasks", { progress: "timeline:in_progress" }), false);
  assert.equal(matches(task, "tasks", { progress: "task:in_progress" }), true);
});
test("historical partner IDs remain filterable and clearing restores results", () => {
  assert.equal(matches(workstream, "workstreams", { partner: "athens" }), true);
  assert.equal(matches(meeting, "events", { organizer: "previous" }), false);
  assert.equal(matches(meeting, "events", emptyScheduleFilters), true);
});
test("removed entries and tasks without deadlines do not enter schedule views", () => {
  assert.equal(matches({ ...meeting, status: "removed" }, "events"), false);
  assert.equal(matches({ ...task, due_date: null }, "tasks"), false);
  assert.equal(matches(task, "tasks"), true);
});
