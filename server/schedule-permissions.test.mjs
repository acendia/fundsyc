import test from "node:test";
import assert from "node:assert/strict";
import {
  loadSchedulePermissionContext, canReadSchedule, canChangeSchedule, canReadScheduleItem,
  canManageTimelineItem, canUpdateTimelineItem, canManageScheduleEvent, canUpdateScheduleEvent,
} from "./schedule-permissions.mjs";

const proposal = { id: "proposal", status: "draft", coordinator_partner_id: "athens" };
const actor = (role, partner = "harokopio") => ({
  proposal_id: proposal.id, user_id: "me", partner_id: partner, access_role: role,
  membership_status: "active", user_status: "active", partner_status: "active",
});
const timeline = { id: "workstream-or-milestone", proposal_id: proposal.id, lead_partner_id: "harokopio", status: "active" };
const event = { id: "event", proposal_id: proposal.id, partner_id: "harokopio", organizer_user_id: "me", status: "active" };

test("all active roles can read across partners", () => {
  for (const role of ["coordinator_manager", "partner_admin", "contributor", "viewer"]) {
    assert.equal(canReadScheduleItem(actor(role), proposal, { ...event, partner_id: "ucla" }), true);
    assert.equal(canReadScheduleItem(actor(role), proposal, { ...timeline, lead_partner_id: "ucla" }), true);
  }
});

test("only the coordinator from the coordinating partner manages the whole schedule", () => {
  const coordinator = actor("coordinator_manager", "athens");
  assert.equal(canManageTimelineItem(coordinator, proposal, timeline), true);
  assert.equal(canManageScheduleEvent(coordinator, proposal, event), true);
  assert.equal(canUpdateTimelineItem(coordinator, proposal, timeline, { ...timeline, lead_partner_id: "ucla" }), true);
  assert.equal(canUpdateScheduleEvent(coordinator, proposal, event, { ...event, partner_id: "ucla", organizer_user_id: "other" }), true);
  assert.equal(canManageTimelineItem(actor("coordinator_manager"), proposal, timeline), false);
  assert.equal(canManageScheduleEvent(actor("coordinator_manager"), proposal, event), false);
});

test("partner admins manage their partner and cannot transfer or take over other partners' items", () => {
  const admin = actor("partner_admin");
  const otherTimeline = { ...timeline, lead_partner_id: "ucla" };
  const otherEvent = { ...event, partner_id: "ucla" };
  assert.equal(canManageTimelineItem(admin, proposal, timeline), true);
  assert.equal(canManageScheduleEvent(admin, proposal, { ...event, organizer_user_id: "colleague" }), true);
  assert.equal(canUpdateScheduleEvent(admin, proposal, event, { ...event, organizer_user_id: "colleague" }), true);
  assert.equal(canUpdateTimelineItem(admin, proposal, timeline, otherTimeline), false);
  assert.equal(canUpdateTimelineItem(admin, proposal, otherTimeline, timeline), false);
  assert.equal(canUpdateScheduleEvent(admin, proposal, event, otherEvent), false);
  assert.equal(canUpdateScheduleEvent(admin, proposal, otherEvent, event), false);
});

test("contributors manage events they organize in their own partner", () => {
  const contributor = actor("contributor");
  assert.equal(canManageScheduleEvent(contributor, proposal, event), true);
  assert.equal(canUpdateScheduleEvent(contributor, proposal, event, { ...event, notes: "Updated" }), true);
  assert.equal(canManageTimelineItem(contributor, proposal, timeline), false);
  assert.equal(canManageScheduleEvent(contributor, proposal, { ...event, organizer_user_id: "colleague" }), false);
  assert.equal(canManageScheduleEvent(contributor, proposal, { ...event, partner_id: "ucla" }), false);
  assert.equal(canUpdateScheduleEvent(contributor, proposal, event, { ...event, organizer_user_id: "colleague" }), false);
  assert.equal(canUpdateScheduleEvent(contributor, proposal, { ...event, organizer_user_id: "colleague" }, event), false);
  assert.equal(canManageScheduleEvent(contributor, proposal, { ...event, created_by_user_id: "someone-else" }), true);
  assert.equal(canManageScheduleEvent(contributor, proposal, { ...event, organizer_user_id: "someone-else", created_by_user_id: "me" }), false);
});

test("viewers and submitted or archived proposals allow reading and reject writes", () => {
  const cases = [
    [actor("viewer"), proposal],
    ...["submitted", "archived"].map(status => [actor("coordinator_manager", "athens"), { ...proposal, status }]),
  ];
  for (const [member, p] of cases) {
    assert.equal(canReadScheduleItem(member, p, event), true);
    assert.equal(canChangeSchedule(member, p), false);
    assert.equal(canManageTimelineItem(member, p, timeline), false);
    assert.equal(canManageScheduleEvent(member, p, event), false);
    assert.equal(canUpdateTimelineItem(member, p, timeline, timeline), false);
    assert.equal(canUpdateScheduleEvent(member, p, event, event), false);
  }
  assert.equal(canManageScheduleEvent(actor("contributor"), { ...proposal, status: "in_preparation" }, event), true);
});

test("missing access, revoked memberships, inactive accounts and withdrawn partners deny access", () => {
  const members = [
    null, { ...actor("contributor"), membership_status: "revoked" },
    { ...actor("contributor"), user_status: "disabled" },
    { ...actor("contributor"), partner_status: "withdrawn" },
    { ...actor("contributor"), access_role: "unknown" },
    { ...actor("contributor"), proposal_id: "other" },
  ];
  for (const member of members) {
    assert.equal(canReadSchedule(member, proposal), false);
    assert.equal(canManageTimelineItem(member, proposal, timeline), false);
    assert.equal(canManageScheduleEvent(member, proposal, event), false);
  }
  assert.equal(canReadSchedule(actor("contributor"), null), false);
});

test("removed and cross-proposal items cannot be read or changed and updates preserve identity", () => {
  const coordinator = actor("coordinator_manager", "athens");
  for (const change of [{ status: "removed" }, { proposal_id: "other" }]) {
    assert.equal(canReadScheduleItem(coordinator, proposal, { ...event, ...change }), false);
    assert.equal(canManageTimelineItem(coordinator, proposal, { ...timeline, ...change }), false);
    assert.equal(canManageScheduleEvent(coordinator, proposal, { ...event, ...change }), false);
    assert.equal(canUpdateTimelineItem(coordinator, proposal, timeline, { ...timeline, ...change }), false);
    assert.equal(canUpdateScheduleEvent(coordinator, proposal, event, { ...event, ...change }), false);
  }
  assert.equal(canUpdateTimelineItem(coordinator, proposal, timeline, { ...timeline, id: "other" }), false);
  assert.equal(canUpdateScheduleEvent(coordinator, proposal, event, { ...event, id: "other" }), false);
  assert.equal(canManageScheduleEvent(coordinator, proposal, null), false);
  assert.equal(canManageTimelineItem(coordinator, proposal, null), false);
});

test("permission context reads the database again after membership revocation", async () => {
  let member = actor("contributor");
  const database = {
    async query(sql, params) {
      assert.equal(params[0], proposal.id);
      if (params.length === 1) return { rows: [proposal] };
      assert.equal(params[1], member.user_id);
      return { rows: [member] };
    },
  };
  const first = await loadSchedulePermissionContext(database, proposal.id, member.user_id);
  assert.equal(canManageScheduleEvent(first.actor, first.proposal, event), true);
  member = { ...member, membership_status: "revoked" };
  const second = await loadSchedulePermissionContext(database, proposal.id, member.user_id);
  assert.equal(canReadSchedule(second.actor, second.proposal), false);
  const missing = await loadSchedulePermissionContext({ query: async () => ({ rows: [] }) }, "missing", "missing");
  assert.deepEqual(missing, { proposal: null, actor: null });
});
