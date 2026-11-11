const roles = ["coordinator_manager", "partner_admin", "contributor", "viewer"];

// use current membership and account state when checking access
export async function loadSchedulePermissionContext(database, proposalId, userId) {
  const [proposal, member] = await Promise.all([
    database.query("select id,status,coordinator_partner_id from proposals where id=$1", [proposalId]),
    database.query(
      "select m.proposal_id,m.user_id,m.partner_id,m.access_role,m.status as membership_status,u.status as user_status,cp.status as partner_status from proposal_memberships m join users u on u.id=m.user_id join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.user_id=$2",
      [proposalId, userId],
    ),
  ]);
  return { proposal: proposal.rows[0] ?? null, actor: member.rows[0] ?? null };
}

export function canReadSchedule(actor, proposal) {
  return Boolean(actor && proposal && actor.proposal_id === proposal.id
    && actor.membership_status === "active" && actor.user_status === "active"
    && actor.partner_status === "active" && roles.includes(actor.access_role));
}

export function canChangeSchedule(actor, proposal) {
  return canReadSchedule(actor, proposal) && actor.access_role !== "viewer"
    && ["draft", "in_preparation"].includes(proposal.status);
}

function managesPartner(actor, proposal, partnerId) {
  return (actor.access_role === "coordinator_manager" && actor.partner_id === proposal.coordinator_partner_id)
    || (actor.access_role === "partner_admin" && actor.partner_id === partnerId);
}

function isActiveItem(item, proposal) {
  return Boolean(item && proposal && item.proposal_id === proposal.id && item.status === "active");
}

export function canReadScheduleItem(actor, proposal, item) {
  return canReadSchedule(actor, proposal) && isActiveItem(item, proposal);
}

// workstreams and milestones have the same lead partner rules
export function canManageTimelineItem(actor, proposal, item) {
  return canChangeSchedule(actor, proposal) && isActiveItem(item, proposal)
    && managesPartner(actor, proposal, item.lead_partner_id);
}

export function canUpdateTimelineItem(actor, proposal, current, next) {
  return canManageTimelineItem(actor, proposal, current)
    && canManageTimelineItem(actor, proposal, next) && current.id === next.id;
}

export function canManageScheduleEvent(actor, proposal, event) {
  if (!canChangeSchedule(actor, proposal) || !isActiveItem(event, proposal)) return false;
  return managesPartner(actor, proposal, event.partner_id)
    || (actor.access_role === "contributor" && actor.partner_id === event.partner_id
      && actor.user_id === event.organizer_user_id);
}

// check the current event too, so changing the organizer cannot take over another event
export function canUpdateScheduleEvent(actor, proposal, current, next) {
  return canManageScheduleEvent(actor, proposal, current)
    && canManageScheduleEvent(actor, proposal, next) && current.id === next.id;
}
