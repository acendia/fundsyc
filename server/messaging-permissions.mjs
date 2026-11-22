const roles = ["coordinator_manager", "partner_admin", "contributor", "viewer"];

// read current membership, account and partner state, plus the conversation and the caller's place in it
export async function loadMessagingPermissionContext(database, proposalId, userId, conversationId = null) {
  const [proposal, member] = await Promise.all([
    database.query("select id,status,coordinator_partner_id from proposals where id=$1", [proposalId]),
    database.query("select m.proposal_id,m.user_id,m.partner_id,m.access_role,m.status as membership_status,u.status as user_status,cp.status as partner_status from proposal_memberships m join users u on u.id=m.user_id join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.user_id=$2", [proposalId, userId]),
  ]);
  let conversation = null, participant = null;
  if (conversationId) {
    conversation = (await database.query("select id,proposal_id,kind,title,created_by_user_id,status from conversations where id=$1 and proposal_id=$2", [conversationId, proposalId])).rows[0] ?? null;
    participant = (await database.query("select conversation_id,user_id,status from conversation_members where conversation_id=$1 and user_id=$2", [conversationId, userId])).rows[0] ?? null;
  }
  return { proposal: proposal.rows[0] ?? null, actor: member.rows[0] ?? null, conversation, participant };
}

// viewers do not take part in messaging
export function canReadMessaging(actor, proposal) {
  return Boolean(actor && proposal && actor.proposal_id === proposal.id
    && actor.membership_status === "active" && actor.user_status === "active"
    && actor.partner_status === "active" && roles.includes(actor.access_role) && actor.access_role !== "viewer");
}

// proposal status never blocks messaging
export function canWriteMessaging(actor, proposal) {
  return canReadMessaging(actor, proposal) && actor.access_role !== "viewer";
}

function isCoordinator(actor, proposal) {
  return actor.access_role === "coordinator_manager" && actor.partner_id === proposal.coordinator_partner_id;
}

// only the caller's own active participation counts, participants are the only readers
export function canReadConversation(actor, proposal, conversation, participant) {
  return canReadMessaging(actor, proposal) && Boolean(conversation) && conversation.proposal_id === proposal.id
    && conversation.status === "active" && Boolean(participant) && participant.status === "active"
    && participant.user_id === actor.user_id && participant.conversation_id === conversation.id;
}

export function canSendMessage(actor, proposal, conversation, participant) {
  return canWriteMessaging(actor, proposal) && canReadConversation(actor, proposal, conversation, participant);
}

// only the creator of a group changes its participants or closes it
export function canManageGroup(actor, proposal, conversation, participant) {
  return canSendMessage(actor, proposal, conversation, participant)
    && conversation.kind === "group" && conversation.created_by_user_id === actor.user_id;
}

// the creator keeps the group open, direct chats cannot be left
export function canLeaveGroup(actor, proposal, conversation, participant) {
  return canReadConversation(actor, proposal, conversation, participant)
    && conversation.kind === "group" && conversation.created_by_user_id !== actor.user_id;
}

// authors remove their own messages, the coordinator moderates groups they take part in
export function canRemoveMessage(actor, proposal, conversation, participant, message) {
  return canSendMessage(actor, proposal, conversation, participant) && Boolean(message)
    && message.status === "active" && message.conversation_id === conversation.id
    && (message.author_user_id === actor.user_id || (conversation.kind === "group" && isCoordinator(actor, proposal)));
}
