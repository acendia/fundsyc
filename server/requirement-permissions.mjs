const roles = ["coordinator_manager", "partner_admin", "contributor", "viewer"];

// read current membership, account and partner state from the database
export async function loadRequirementPermissionContext(database, proposalId, userId) {
  const [proposal, member] = await Promise.all([
    database.query("select id,status,coordinator_partner_id from proposals where id=$1", [proposalId]),
    database.query("select m.proposal_id,m.user_id,m.partner_id,m.access_role,m.status as membership_status,u.status as user_status,cp.status as partner_status from proposal_memberships m join users u on u.id=m.user_id join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.user_id=$2", [proposalId, userId]),
  ]);
  return { proposal: proposal.rows[0] ?? null, actor: member.rows[0] ?? null };
}

// every active member can read, viewers included
export function canReadRequirements(actor, proposal) {
  return Boolean(actor && proposal && actor.proposal_id === proposal.id
    && actor.membership_status === "active" && actor.user_status === "active"
    && actor.partner_status === "active" && roles.includes(actor.access_role));
}

// only the coordinator of the coordinating partner changes requirements, and only while the proposal is editable
export function canManageRequirements(actor, proposal) {
  return canReadRequirements(actor, proposal) && ["draft", "in_preparation"].includes(proposal.status)
    && actor.access_role === "coordinator_manager" && actor.partner_id === proposal.coordinator_partner_id;
}
