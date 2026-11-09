const roles = ["coordinator_manager", "partner_admin", "contributor", "viewer"];

// read current membership, account and partner state from the database
export async function loadTaskPermissionContext(database, proposalId, userId) {
  const [proposal, member] = await Promise.all([
    database.query("select id,status,coordinator_partner_id from proposals where id=$1", [proposalId]),
    database.query("select m.proposal_id,m.user_id,m.partner_id,m.access_role,m.status as membership_status,u.status as user_status,cp.status as partner_status from proposal_memberships m join users u on u.id=m.user_id join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.user_id=$2", [proposalId, userId]),
  ]);
  return { proposal: proposal.rows[0] ?? null, actor: member.rows[0] ?? null };
}

export function canReadTasks(actor, proposal) {
  return Boolean(actor && proposal && actor.proposal_id === proposal.id
    && actor.membership_status === "active" && actor.user_status === "active"
    && actor.partner_status === "active" && roles.includes(actor.access_role));
}

export function canChangeTasks(actor, proposal) {
  return canReadTasks(actor, proposal) && actor.access_role !== "viewer"
    && ["draft", "in_preparation"].includes(proposal.status);
}

function isCoordinator(actor, proposal) {
  return actor.access_role === "coordinator_manager" && actor.partner_id === proposal.coordinator_partner_id;
}

function managesPartner(actor, proposal, partnerId) {
  return isCoordinator(actor, proposal)
    || (actor.access_role === "partner_admin" && actor.partner_id === partnerId);
}

function isActiveTask(task, proposal) {
  return Boolean(task && proposal && task.proposal_id === proposal.id && task.status === "active");
}

export function canReadTask(actor, proposal, task) {
  return canReadTasks(actor, proposal) && isActiveTask(task, proposal);
}

export function canCreateTask(actor, proposal, task) {
  if (!canChangeTasks(actor, proposal) || !isActiveTask(task, proposal)) return false;
  return managesPartner(actor, proposal, task.partner_id)
    || (actor.access_role === "contributor" && actor.partner_id === task.partner_id && actor.user_id === task.assignee_user_id);
}

export function canEditTask(actor, proposal, task) {
  return canCreateTask(actor, proposal, task);
}

// check both sides so an admin cannot move another partner's task
export function canAssignTask(actor, proposal, task, nextPartnerId = task?.partner_id) {
  return canChangeTasks(actor, proposal) && isActiveTask(task, proposal)
    && managesPartner(actor, proposal, task.partner_id) && managesPartner(actor, proposal, nextPartnerId);
}

export function canRemoveTask(actor, proposal, task) {
  return canAssignTask(actor, proposal, task);
}

// contributors can edit their task, but cannot change who owns the assignment
export function canUpdateTask(actor, proposal, current, next) {
  if (!canEditTask(actor, proposal, current) || !isActiveTask(next, proposal) || current.id !== next.id) return false;
  const assignmentChanged = current.partner_id !== next.partner_id || current.assignee_user_id !== next.assignee_user_id
    || current.assigned_by_user_id !== next.assigned_by_user_id || current.assigned_at !== next.assigned_at;
  return !assignmentChanged || canAssignTask(actor, proposal, current, next.partner_id);
}

export function canCommentOnTask(actor, proposal, task) {
  return canChangeTasks(actor, proposal) && isActiveTask(task, proposal);
}

export function canEditTaskComment(actor, proposal, task, comment) {
  return canCommentOnTask(actor, proposal, task) && Boolean(comment && comment.status === "active"
    && comment.proposal_id === proposal.id && comment.task_id === task.id && comment.author_user_id === actor.user_id);
}

export function canRemoveTaskComment(actor, proposal, task, comment) {
  return canCommentOnTask(actor, proposal, task) && Boolean(comment && comment.status === "active"
    && comment.proposal_id === proposal.id && comment.task_id === task.id
    && (comment.author_user_id === actor.user_id || isCoordinator(actor, proposal)));
}
