import { randomUUID } from "node:crypto";
import {
  loadMessagingPermissionContext, canReadMessaging, canWriteMessaging, canReadConversation, canSendMessage,
  canManageGroup, canLeaveGroup, canRemoveMessage,
} from "./messaging-permissions.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// only strings count, arrays would otherwise match the regex after coercion
const validUuid = value => typeof value === "string" && uuid.test(value);
const lower = value => typeof value === "string" ? value.toLowerCase() : undefined;
const pageSize = 50;
const maxGroupMembers = 100;

// the same candidates the database trigger accepts: active, non-viewer, current partner
const eligibleMembers = `select m.user_id, u.display_name, o.legal_name as partner_name, m.access_role
 from proposal_memberships m
 join users u on u.id=m.user_id
 join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id
 join organizations o on o.id=cp.organization_id
 where m.proposal_id=$1 and m.status='active' and m.access_role<>'viewer' and u.status='active' and cp.status='active'`;

// trimmed, counted in characters like the database check
function cleanBody(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && [...text].length <= 2000 ? text : null;
}

function cleanTitle(value) {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title && [...title].length <= 120 ? title : null;
}

// audit rows only hold ids and action names, never message text, group names or who is in a group
async function auditMessagingEvent(client, proposalId, userId, action, entityType, entityId) {
  await client.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id) values($1,$2,$3,$4,$5,$6)", [randomUUID(), proposalId, userId, action, entityType, entityId]);
}

// add or reactivate a participant, reactivation keeps the same row and records the new join
async function addParticipant(client, proposalId, conversationId, userId, addedBy) {
  const result = await client.query(`insert into conversation_members(id,proposal_id,conversation_id,user_id,added_by_user_id) values($1,$2,$3,$4,$5)
    on conflict (conversation_id,user_id) do update set status='active',added_by_user_id=excluded.added_by_user_id,joined_at=now(),ended_at=null,ended_by_user_id=null,updated_at=now()
    where conversation_members.status<>'active'`, [randomUUID(), proposalId, conversationId, userId, addedBy]);
  return result.rowCount === 1;
}

async function eligibleUserIds(client, proposalId, userIds) {
  const rows = (await client.query(`${eligibleMembers} and m.user_id=any($2::uuid[])`, [proposalId, userIds])).rows;
  return new Set(rows.map(row => row.user_id));
}

// newest first in the query, returned oldest first; removed messages keep their place without the body
async function loadMessages(database, proposalId, conversationId, beforeId) {
  const params = beforeId ? [conversationId, proposalId, beforeId] : [conversationId, proposalId];
  const older = beforeId ? "and (m.created_at,m.id)<(select c.created_at,c.id from messages c where c.id=$3 and c.conversation_id=$1)" : "";
  const rows = (await database.query(`select m.id,m.conversation_id,m.author_user_id,u.display_name as author_name,case when m.status='active' then m.body end as body,m.status,m.created_at,m.removed_at
    from messages m join users u on u.id=m.author_user_id
    where m.conversation_id=$1 and m.proposal_id=$2 ${older}
    order by m.created_at desc,m.id desc limit ${pageSize + 1}`, params)).rows;
  return { messages: rows.slice(0, pageSize).reverse(), hasMore: rows.length > pageSize };
}

function withPermissions(actor, proposal, conversation, participant, messages) {
  return messages.map(message => ({
    ...message,
    is_own: message.author_user_id === actor.user_id,
    can_remove: canRemoveMessage(actor, proposal, conversation, participant, message),
  }));
}

// both messages and overview list only the caller's own active conversations
// $1 is the proposal, the caller placeholder and limit are passed in so the overview can reuse this in its batch
export const conversationSummariesSql = (userParam = "$2", limitSql = "") => `select c.id,c.kind,
      case when c.kind='group' then c.title else other.display_name end as title,
      c.created_by_user_id,c.created_at,coalesce(lastmsg.created_at,c.created_at) as last_activity_at
    from conversation_members me
    join conversations c on c.id=me.conversation_id and c.proposal_id=me.proposal_id
    left join lateral (select u.display_name from conversation_members o join users u on u.id=o.user_id
      where o.conversation_id=c.id and o.user_id<>me.user_id and o.status='active' limit 1) other on c.kind='direct'
    left join lateral (select max(m.created_at) as created_at from messages m where m.conversation_id=c.id and m.status='active') lastmsg on true
    where me.proposal_id=$1 and me.user_id=${userParam} and me.status='active' and c.status='active'
    order by last_activity_at desc,c.id desc ${limitSql}`;

export async function loadConversationSummaries(database, proposalId, userId, limit = null) {
  return (await database.query(conversationSummariesSql("$2", limit === null ? "" : "limit $3"), limit === null ? [proposalId, userId] : [proposalId, userId, limit])).rows;
}

export function addMessagingRoutes(app) {
  const base = "/api/proposals/:proposalId/conversations";
  // messages are private, so nothing here may be cached
  app.use(base, (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });

  app.get(base, async (req, res) => {
    const proposalId = lower(req.params.proposalId);
    if (!validUuid(proposalId)) return res.status(404).json({ error: "Proposal not found." });
    try {
      const { actor, proposal } = await loadMessagingPermissionContext(req.database, proposalId, req.userId);
      if (!canReadMessaging(actor, proposal)) return res.status(403).json({ error: "You do not have access to this proposal." });
      // only chats where the caller is still an active participant, no message text here
      const conversations = await loadConversationSummaries(req.database, proposalId, req.userId);
      const people = canWriteMessaging(actor, proposal)
        ? (await req.database.query(`${eligibleMembers} and m.user_id<>$2 order by u.display_name,m.user_id`, [proposalId, req.userId])).rows
        : [];
      res.json({ current_user_id: req.userId, can_start: canWriteMessaging(actor, proposal), people, conversations });
    } catch (error) {
      console.error("conversation list failed", error);
      res.status(500).json({ error: "Could not load messages." });
    }
  });

  app.get(`${base}/:conversationId`, async (req, res) => {
    const proposalId = lower(req.params.proposalId), conversationId = lower(req.params.conversationId);
    if (!validUuid(proposalId)) return res.status(404).json({ error: "Proposal not found." });
    if (!validUuid(conversationId)) return res.status(404).json({ error: "Conversation not found." });
    try {
      const { actor, proposal, conversation, participant } = await loadMessagingPermissionContext(req.database, proposalId, req.userId, conversationId);
      if (!canReadMessaging(actor, proposal)) return res.status(403).json({ error: "You do not have access to this proposal." });
      // non-participants get the same answer as a missing conversation
      if (!canReadConversation(actor, proposal, conversation, participant)) return res.status(404).json({ error: "Conversation not found." });
      const members = (await req.database.query(`select cm.user_id,u.display_name,o.legal_name as partner_name,cm.joined_at
        from conversation_members cm
        join users u on u.id=cm.user_id
        left join proposal_memberships m on m.proposal_id=cm.proposal_id and m.user_id=cm.user_id and m.status='active'
        left join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id
        left join organizations o on o.id=cp.organization_id
        where cm.conversation_id=$1 and cm.status='active' order by u.display_name,cm.user_id`, [conversationId])).rows
        .map(member => ({ ...member, is_creator: member.user_id === conversation.created_by_user_id }));
      const manage = canManageGroup(actor, proposal, conversation, participant);
      const addable = manage
        ? (await req.database.query(`${eligibleMembers} and not exists (select 1 from conversation_members cm where cm.conversation_id=$2 and cm.user_id=m.user_id and cm.status='active') order by u.display_name,m.user_id`, [proposalId, conversationId])).rows
        : [];
      const page = await loadMessages(req.database, proposalId, conversationId, null);
      res.json({
        current_user_id: req.userId,
        conversation: { id: conversation.id, kind: conversation.kind, title: conversation.title, created_by_user_id: conversation.created_by_user_id, status: conversation.status },
        members, addable,
        messages: withPermissions(actor, proposal, conversation, participant, page.messages),
        has_more: page.hasMore,
        can_send: canSendMessage(actor, proposal, conversation, participant),
        can_manage: manage,
        can_leave: canLeaveGroup(actor, proposal, conversation, participant),
      });
    } catch (error) {
      console.error("conversation read failed", error);
      res.status(500).json({ error: "Could not load this conversation." });
    }
  });

  app.get(`${base}/:conversationId/messages`, async (req, res) => {
    const proposalId = lower(req.params.proposalId), conversationId = lower(req.params.conversationId);
    if (!validUuid(proposalId)) return res.status(404).json({ error: "Proposal not found." });
    if (!validUuid(conversationId)) return res.status(404).json({ error: "Conversation not found." });
    const before = lower(req.query.before);
    if (!validUuid(before)) return res.status(400).json({ error: "Choose the oldest loaded message to load older messages." });
    try {
      const { actor, proposal, conversation, participant } = await loadMessagingPermissionContext(req.database, proposalId, req.userId, conversationId);
      if (!canReadMessaging(actor, proposal)) return res.status(403).json({ error: "You do not have access to this proposal." });
      if (!canReadConversation(actor, proposal, conversation, participant)) return res.status(404).json({ error: "Conversation not found." });
      const cursor = await req.database.query("select 1 from messages where id=$1 and conversation_id=$2 and proposal_id=$3", [before, conversationId, proposalId]);
      if (!cursor.rowCount) return res.status(404).json({ error: "Message not found." });
      const page = await loadMessages(req.database, proposalId, conversationId, before);
      res.json({ messages: withPermissions(actor, proposal, conversation, participant, page.messages), has_more: page.hasMore });
    } catch (error) {
      console.error("older messages read failed", error);
      res.status(500).json({ error: "Could not load older messages." });
    }
  });

  // every write locks the proposal first, like the membership and partner routes, then rechecks access
  async function change(req, res, action) {
    const proposalId = lower(req.params.proposalId), conversationId = lower(req.params.conversationId);
    const messageId = lower(req.params.messageId), memberId = lower(req.params.memberId);
    const bad = [[proposalId, "Proposal not found."], [conversationId, "Conversation not found."], [messageId, "Message not found."], [memberId, "Member not found."]]
      .find(([id]) => id !== undefined && !validUuid(id));
    if (!validUuid(proposalId)) return res.status(404).json({ error: "Proposal not found." });
    if (bad) return res.status(404).json({ error: bad[1] });
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    let c;
    try {
      c = await req.database.connect();
      await c.query("begin");
      const fail = async (status, error) => { await c.query("rollback"); return res.status(status).json({ error }); };
      await c.query("select id from proposals where id=$1 for update", [proposalId]);
      if (conversationId) await c.query("select id from conversations where id=$1 and proposal_id=$2 for update", [conversationId, proposalId]);
      const { actor, proposal, conversation, participant } = await loadMessagingPermissionContext(c, proposalId, req.userId, conversationId ?? null);
      if (!canReadMessaging(actor, proposal)) return await fail(403, "You do not have access to this proposal.");

      if (action === "create") {
        if (!canWriteMessaging(actor, proposal)) return await fail(403, "Viewers cannot start conversations.");
        if (body.kind === "direct") {
          const otherId = lower(body.userId);
          if (!validUuid(otherId) || otherId === req.userId) return await fail(400, "Choose another member to message.");
          if (!(await eligibleUserIds(c, proposalId, [otherId])).has(otherId)) return await fail(400, "Choose an active member who can take part in messages.");
          const [low, high] = [req.userId, otherId].sort();
          // the lock above serializes this check, the unique key is the last guard
          const existing = await c.query("select id from conversations where proposal_id=$1 and direct_user_low_id=$2 and direct_user_high_id=$3", [proposalId, low, high]);
          if (existing.rowCount) { await c.query("commit"); return res.json({ id: existing.rows[0].id }); }
          const id = randomUUID();
          await c.query("insert into conversations(id,proposal_id,kind,direct_user_low_id,direct_user_high_id,created_by_user_id) values($1,$2,'direct',$3,$4,$5)", [id, proposalId, low, high, req.userId]);
          await addParticipant(c, proposalId, id, req.userId, req.userId);
          await addParticipant(c, proposalId, id, otherId, req.userId);
          await c.query("commit");
          return res.status(201).json({ id });
        }
        if (body.kind === "group") {
          const title = cleanTitle(body.title);
          const ids = Array.isArray(body.userIds) ? body.userIds : null;
          if (title === null || !ids || ids.length > maxGroupMembers || !ids.every(validUuid)) return await fail(400, "Enter a group name up to 120 characters and choose members.");
          // the creator is always a participant, so leave them out of the list
          const members = [...new Set(ids.map(id => id.toLowerCase()))].filter(id => id !== req.userId);
          const eligible = await eligibleUserIds(c, proposalId, members);
          if (!members.length || members.length + 1 > maxGroupMembers || members.some(id => !eligible.has(id))) return await fail(400, "Choose between 1 and 99 other active members for this group.");
          const id = randomUUID();
          await c.query("insert into conversations(id,proposal_id,kind,title,created_by_user_id) values($1,$2,'group',$3,$4)", [id, proposalId, title, req.userId]);
          await addParticipant(c, proposalId, id, req.userId, req.userId);
          for (const member of members) await addParticipant(c, proposalId, id, member, req.userId);
          await auditMessagingEvent(c, proposalId, req.userId, "conversation.created", "conversation", id);
          await c.query("commit");
          return res.status(201).json({ id });
        }
        return await fail(400, "Choose a direct chat or a group.");
      }

      if (!canReadConversation(actor, proposal, conversation, participant)) return await fail(404, "Conversation not found.");

      if (action === "send") {
        if (!canSendMessage(actor, proposal, conversation, participant)) return await fail(403, "Viewers cannot send messages.");
        const text = cleanBody(body.body);
        if (text === null) return await fail(400, "Enter a message up to 2,000 characters.");
        const id = randomUUID();
        await c.query("insert into messages(id,proposal_id,conversation_id,author_user_id,body) values($1,$2,$3,$4,$5)", [id, proposalId, conversationId, req.userId, text]);
        await c.query("commit");
        return res.status(201).json({ id });
      }

      if (action === "remove_message") {
        const message = (await c.query("select id,conversation_id,author_user_id,status from messages where id=$1 and conversation_id=$2 and proposal_id=$3 and status='active' for update", [messageId, conversationId, proposalId])).rows[0];
        if (!message) return await fail(404, "Message not found.");
        if (!canRemoveMessage(actor, proposal, conversation, participant, message)) return await fail(403, "You cannot remove this message.");
        await c.query("update messages set status='removed',removed_at=now(),removed_by_user_id=$1,updated_at=now() where id=$2", [req.userId, messageId]);
        // only moderation is audited, authors removing their own messages are not
        if (message.author_user_id !== req.userId) await auditMessagingEvent(c, proposalId, req.userId, "message.moderated", "message", messageId);
        await c.query("commit");
        return res.json({ id: messageId });
      }

      if (action === "add_member") {
        if (!canManageGroup(actor, proposal, conversation, participant)) return await fail(403, "Only the group creator can change participants.");
        const target = lower(body.userId);
        if (!validUuid(target)) return await fail(400, "Choose a member to add.");
        if (!(await eligibleUserIds(c, proposalId, [target])).has(target)) return await fail(400, "Choose an active member who can take part in messages.");
        // same cap as group creation
        const count = await c.query("select count(*)::int as n from conversation_members where conversation_id=$1 and status='active'", [conversationId]);
        if (count.rows[0].n >= maxGroupMembers) return await fail(409, "This group has reached its participant limit.");
        if (!(await addParticipant(c, proposalId, conversationId, target, req.userId))) return await fail(409, "This member is already in the group.");
        await auditMessagingEvent(c, proposalId, req.userId, "conversation.member_added", "conversation", conversationId);
        await c.query("commit");
        return res.status(201).json({ id: target });
      }

      if (action === "remove_member") {
        if (!canManageGroup(actor, proposal, conversation, participant)) return await fail(403, "Only the group creator can change participants.");
        if (memberId === conversation.created_by_user_id) return await fail(409, "The group creator cannot be removed.");
        const updated = await c.query("update conversation_members set status='removed',ended_at=now(),ended_by_user_id=$1,updated_at=now() where conversation_id=$2 and user_id=$3 and status='active'", [req.userId, conversationId, memberId]);
        if (!updated.rowCount) return await fail(404, "Member not found.");
        await auditMessagingEvent(c, proposalId, req.userId, "conversation.member_removed", "conversation", conversationId);
        await c.query("commit");
        return res.json({ id: memberId });
      }

      if (action === "leave") {
        if (conversation.kind !== "group") return await fail(409, "Direct chats cannot be left.");
        if (conversation.created_by_user_id === req.userId) return await fail(409, "The group creator cannot leave. Close the group instead.");
        if (!canLeaveGroup(actor, proposal, conversation, participant)) return await fail(403, "You cannot leave this group.");
        await c.query("update conversation_members set status='left',ended_at=now(),ended_by_user_id=$1,updated_at=now() where conversation_id=$2 and user_id=$1 and status='active'", [req.userId, conversationId]);
        await auditMessagingEvent(c, proposalId, req.userId, "conversation.member_left", "conversation", conversationId);
        await c.query("commit");
        return res.json({ id: conversationId });
      }

      if (action === "close") {
        if (!canManageGroup(actor, proposal, conversation, participant)) return await fail(403, "Only the group creator can close this group.");
        await c.query("update conversations set status='removed',removed_at=now(),removed_by_user_id=$1,updated_at=now() where id=$2 and proposal_id=$3", [req.userId, conversationId, proposalId]);
        await auditMessagingEvent(c, proposalId, req.userId, "conversation.removed", "conversation", conversationId);
        await c.query("commit");
        return res.json({ id: conversationId });
      }
      return await fail(500, "Unknown messaging action.");
    } catch (error) {
      if (c) await c.query("rollback").catch(() => {});
      // the database refused a write the api allowed, usually because the state changed meanwhile
      if (error.code === "23514") return res.status(409).json({ error: "This conversation changed. Refresh and try again." });
      console.error("messaging change failed", error);
      res.status(500).json({ error: "Could not save this change." });
    } finally { c?.release(); }
  }

  app.post(base, (req, res) => change(req, res, "create"));
  app.post(`${base}/:conversationId/messages`, (req, res) => change(req, res, "send"));
  app.delete(`${base}/:conversationId/messages/:messageId`, (req, res) => change(req, res, "remove_message"));
  app.post(`${base}/:conversationId/members`, (req, res) => change(req, res, "add_member"));
  app.delete(`${base}/:conversationId/members/:memberId`, (req, res) => change(req, res, "remove_member"));
  app.post(`${base}/:conversationId/leave`, (req, res) => change(req, res, "leave"));
  app.delete(`${base}/:conversationId`, (req, res) => change(req, res, "close"));
}
