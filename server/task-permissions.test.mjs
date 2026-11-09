import test from "node:test";
import assert from "node:assert/strict";
import { canReadTasks, canReadTask, canCreateTask, canEditTask, canAssignTask, canUpdateTask, canRemoveTask, canCommentOnTask, canEditTaskComment, canRemoveTaskComment } from "./task-permissions.mjs";
const proposal = { id: "proposal", status: "draft", coordinator_partner_id: "athens" };
const actor = (role, partner = "harokopio") => ({ proposal_id: proposal.id, user_id: "me", partner_id: partner, access_role: role, membership_status: "active", user_status: "active", partner_status: "active" });
const task = { id: "task", proposal_id: proposal.id, partner_id: "harokopio", assignee_user_id: "me", status: "active" };

test("members can read across partners, but revoked or inactive accounts and partners cannot", () => {
  for (const role of ["coordinator_manager", "partner_admin", "contributor", "viewer"]) assert.equal(canReadTask(actor(role), proposal, { ...task, partner_id: "ucla" }), true);
  for (const field of ["membership_status", "user_status", "partner_status"]) assert.equal(canReadTasks({ ...actor("contributor"), [field]: "inactive" }, proposal), false);
  assert.equal(canReadTasks(null, proposal), false);
  assert.equal(canReadTasks(actor("contributor"), null), false);
  assert.equal(canReadTasks({ ...actor("contributor"), proposal_id: "other" }, proposal), false);
  assert.equal(canReadTask(actor("contributor"), proposal, { ...task, proposal_id: "other" }), false);
  assert.equal(canReadTask(actor("contributor"), proposal, { ...task, status: "removed" }), false);
});

test("only a coordinator from the coordinating partner can manage all partners", () => {
  const coordinator = actor("coordinator_manager", "athens");
  assert.equal(canCreateTask(coordinator, proposal, task), true);
  assert.equal(canAssignTask(coordinator, proposal, task, "ucla"), true);
  assert.equal(canRemoveTask(coordinator, proposal, task), true);
  assert.equal(canEditTask(actor("coordinator_manager"), proposal, task), false);
});

test("partner admins cannot modify or transfer another partner's tasks", () => {
  const admin = actor("partner_admin");
  assert.equal(canCreateTask(admin, proposal, { ...task, assignee_user_id: null }), true);
  assert.equal(canAssignTask(admin, proposal, task), true);
  assert.equal(canRemoveTask(admin, proposal, task), true);
  assert.equal(canAssignTask(admin, proposal, task, "ucla"), false);
  assert.equal(canEditTask(admin, proposal, { ...task, partner_id: "ucla" }), false);
  assert.equal(canAssignTask(admin, proposal, { ...task, partner_id: "ucla" }, "harokopio"), false);
});

test("contributors create for themselves and edit assigned tasks without reassigning or removing", () => {
  const contributor = actor("contributor");
  assert.equal(canCreateTask(contributor, proposal, task), true);
  assert.equal(canCreateTask(contributor, proposal, { ...task, assignee_user_id: null }), false);
  assert.equal(canEditTask(contributor, proposal, { ...task, assignee_user_id: "colleague" }), false);
  assert.equal(canUpdateTask(contributor, proposal, task, { ...task, title: "Updated" }), true);
  for (const field of ["assignee_user_id", "partner_id", "assigned_by_user_id", "assigned_at"]) assert.equal(canUpdateTask(contributor, proposal, task, { ...task, [field]: "changed" }), false);
  assert.equal(canRemoveTask(contributor, proposal, task), false);
  assert.equal(canCommentOnTask(contributor, proposal, { ...task, partner_id: "ucla" }), true);
});

test("viewers and read-only proposals reject every task write", () => {
  for (const [member, p] of [[actor("viewer"), proposal], ...["submitted", "archived"].map(status => [actor("coordinator_manager", "athens"), { ...proposal, status }])]) {
    assert.equal(canReadTask(member, p, task), true);
    for (const check of [canCreateTask, canEditTask, canAssignTask, canRemoveTask, canCommentOnTask]) assert.equal(check(member, p, task), false);
    assert.equal(canUpdateTask(member, p, task, task), false);
  }
});

test("comment ownership and coordinator moderation require current writable access", () => {
  const comment = { proposal_id: proposal.id, task_id: task.id, status: "active", author_user_id: "me" };
  const contributor = actor("contributor");
  assert.equal(canEditTaskComment(contributor, proposal, task, comment), true);
  assert.equal(canRemoveTaskComment(contributor, proposal, task, comment), true);
  assert.equal(canEditTaskComment(contributor, proposal, task, { ...comment, author_user_id: "other" }), false);
  assert.equal(canRemoveTaskComment(actor("partner_admin"), proposal, task, { ...comment, author_user_id: "other" }), false);
  assert.equal(canRemoveTaskComment(actor("coordinator_manager", "athens"), proposal, task, { ...comment, author_user_id: "other" }), true);
  for (const check of [canEditTaskComment, canRemoveTaskComment]) {
    assert.equal(check(actor("viewer"), proposal, task, comment), false);
    assert.equal(check(contributor, { ...proposal, status: "submitted" }, task, comment), false);
    assert.equal(check(contributor, proposal, task, { ...comment, task_id: "other" }), false);
    assert.equal(check(contributor, proposal, task, { ...comment, status: "removed" }), false);
    assert.equal(check({ ...contributor, membership_status: "revoked" }, proposal, task, comment), false);
  }
});
