export function canAddDocument(actor) {
  return Boolean(actor && ["coordinator_manager", "partner_admin", "contributor"].includes(actor.access_role));
}

export function canManageDocument(actor, owner, coordinatorPartnerId) {
  if (!canAddDocument(actor) || !owner) return false;
  if (actor.access_role === "coordinator_manager") return actor.partner_id === coordinatorPartnerId;
  if (actor.access_role === "partner_admin") return actor.partner_id === owner.partner_id;
  return actor.user_id === owner.user_id;
}

export function canChangeDocuments(proposal) {
  return Boolean(proposal && ["draft", "in_preparation"].includes(proposal.status));
}

export const documentMemberSql = "select m.user_id, m.partner_id, m.access_role, u.display_name from proposal_memberships m join users u on u.id=m.user_id join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.status='active' and u.status='active' and cp.status='active'";
