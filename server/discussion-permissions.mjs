const roles = ["coordinator_manager", "partner_admin", "contributor", "viewer"];

// use current membership and account state when checking access
export async function loadDiscussionPermissionContext(database, proposalId, userId) {
  const [proposal, member] = await Promise.all([
    database.query("select id,status,coordinator_partner_id from proposals where id=$1", [proposalId]),
    database.query("select m.proposal_id,m.user_id,m.partner_id,m.access_role,m.status as membership_status,u.status as user_status,cp.status as partner_status from proposal_memberships m join users u on u.id=m.user_id join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.user_id=$2", [proposalId, userId]),
  ]);
  return { proposal: proposal.rows[0] ?? null, actor: member.rows[0] ?? null };
}

export function canReadDiscussions(actor, proposal) {
  return Boolean(actor && proposal && actor.proposal_id === proposal.id
    && actor.membership_status === "active" && actor.user_status === "active"
    && actor.partner_status === "active" && roles.includes(actor.access_role));
}

// viewers read only, and proposal status never blocks discussions
export function canWriteDiscussions(actor, proposal) {
  return canReadDiscussions(actor, proposal) && actor.access_role !== "viewer";
}

function isCoordinator(actor, proposal) {
  return actor.access_role === "coordinator_manager" && actor.partner_id === proposal.coordinator_partner_id;
}

function isActive(item, proposal) {
  return Boolean(item && proposal && item.proposal_id === proposal.id && item.status === "active");
}

export function canCreateDiscussion(actor, proposal) {
  return canWriteDiscussions(actor, proposal);
}

export function canReplyToDiscussion(actor, proposal, discussion) {
  return canWriteDiscussions(actor, proposal) && isActive(discussion, proposal);
}

export function canEditDiscussion(actor, proposal, discussion) {
  return canReplyToDiscussion(actor, proposal, discussion) && discussion.created_by_user_id === actor.user_id;
}

// the coordinator can moderate, partner admins only remove their own posts
export function canRemoveDiscussion(actor, proposal, discussion) {
  return canReplyToDiscussion(actor, proposal, discussion)
    && (discussion.created_by_user_id === actor.user_id || isCoordinator(actor, proposal));
}

// a reply is only live while its discussion is live
function isActiveReply(actor, proposal, discussion, reply) {
  return canReplyToDiscussion(actor, proposal, discussion) && isActive(reply, proposal) && reply.discussion_id === discussion.id;
}

export function canEditReply(actor, proposal, discussion, reply) {
  return isActiveReply(actor, proposal, discussion, reply) && reply.created_by_user_id === actor.user_id;
}

export function canRemoveReply(actor, proposal, discussion, reply) {
  return isActiveReply(actor, proposal, discussion, reply)
    && (reply.created_by_user_id === actor.user_id || isCoordinator(actor, proposal));
}
