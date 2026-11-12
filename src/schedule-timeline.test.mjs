import test from "node:test";
import assert from "node:assert/strict";
import { calendarDayCount, timelinePosition } from "./schedule-timeline.ts";

test("timeline bars include both ends and one-day workstreams remain visible", () => {
  assert.equal(calendarDayCount("2028-02-28", "2028-03-01"), 2);
  assert.deepEqual(timelinePosition("2027-01-01", "2027-01-10", "2027-01-01", "2027-01-10"), { left: 0, width: 100 });
  assert.deepEqual(timelinePosition("2027-01-10", "2027-01-10", "2027-01-01", "2027-01-10"), { left: 90, width: 10 });
});

test("workstreams crossing either boundary are clipped and items outside the period are excluded", () => {
  const first = "2027-01-01", last = "2027-01-10";
  assert.deepEqual(timelinePosition("2026-12-01", "2027-01-02", first, last), { left: 0, width: 20 });
  assert.deepEqual(timelinePosition("2027-01-09", "2027-02-01", first, last), { left: 80, width: 20 });
  assert.equal(timelinePosition("2026-12-01", "2026-12-31", first, last), null);
  assert.equal(timelinePosition("2027-01-11", "2027-02-01", first, last), null);
  assert.equal(timelinePosition("2027-01-09", "2027-01-08", first, last), null);
});

test("timeline day arithmetic stays fixed across clock changes", () => {
  assert.equal(calendarDayCount("2027-03-27", "2027-03-29"), 2);
  assert.equal(calendarDayCount("2027-10-30", "2027-11-01"), 2);
});
