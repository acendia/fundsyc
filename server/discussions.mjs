import { randomUUID } from "node:crypto";
import {
  loadDiscussionPermissionContext, canReadDiscussions, canWriteDiscussions, canCreateDiscussion, canReplyToDiscussion,
  canEditDiscussion, canRemoveDiscussion, canEditReply, canRemoveReply,
} from "./discussion-permissions.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// only strings count, arrays would otherwise match the regex after coercion
const validUuid = value => typeof value === "string" && uuid.test(value);
// link kind -> table holding the item, and the key used by the linkable payload
const linkTables = { task: "tasks", event: "schedule_events", workstream: "schedule_workstreams", milestone: "schedule_milestones" };
const linkLists = { task: "tasks", event: "events", workstream: "workstreams", milestone: "milestones" };

async function auditDiscussionEvent(client, proposalId, userId, action, discussionId, metadata = {}) {
  // metadata never holds the body text
  await client.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,$3,$4,'discussion',$5,$6)", [randomUUID(), proposalId, userId, action, discussionId, JSON.stringify(metadata)]);
}

// trimmed, counted in characters like the database check
function cleanTitle(value) {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title && [...title].length <= 200 ? title : null;
}

function cleanBody(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= 10000 ? text : null;
}

// no kind means no link, a kind needs a valid id, anything else is invalid (null)
function readLink(body) {
  const kind = body.linkKind ?? null;
  if (kind === null || kind === "") return { kind: null, id: null };
  if (typeof kind !== "string" || !Object.hasOwn(linkTables, kind) || !validUuid(body.linkId)) return null;
  return { kind, id: body.linkId.toLowerCase() };
}

// the link must be an active item of this proposal, checked under the proposal lock
async function linkIsActive(client, proposalId, link) {
  const found = await client.query(`select 1 from ${linkTables[link.kind]} where id=$1 and proposal_id=$2 and status='active'`, [link.id, proposalId]);
  return found.rowCount > 0;
}

export function addDiscussionRoutes(app) {
  const base = "/api/proposals/:proposalId/discussions";
  app.get(base, async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const proposalId = req.params.proposalId?.toLowerCase();
    if (!uuid.test(proposalId)) return res.status(404).json({ error: "Proposal not found." });
    try {
      const { actor, proposal } = await loadDiscussionPermissionContext(req.database, proposalId, req.userId);
      if (!canReadDiscussions(actor, proposal)) return res.status(403).json({ error: "You do not have access to this proposal." });
      const discussions = (await req.database.query("select d.id,d.proposal_id,d.partner_id,d.created_by_user_id,d.title,d.body,d.linked_kind,d.linked_id,d.status,d.created_at,d.updated_at,d.updated_by_user_id,o.legal_name as partner_name,a.display_name as created_by_name,b.display_name as updated_by_name from discussions d join consortium_partners cp on cp.id=d.partner_id and cp.proposal_id=d.proposal_id join organizations o on o.id=cp.organization_id join users a on a.id=d.created_by_user_id join users b on b.id=d.updated_by_user_id where d.proposal_id=$1 and d.status='active' order by d.updated_at desc,d.id desc", [proposalId])).rows;
      const replies = (await req.database.query("select r.id,r.proposal_id,r.discussion_id,r.partner_id,r.created_by_user_id,r.body,r.status,r.created_at,r.updated_at,o.legal_name as partner_name,a.display_name as created_by_name from discussion_replies r join consortium_partners cp on cp.id=r.partner_id and cp.proposal_id=r.proposal_id join organizations o on o.id=cp.organization_id join users a on a.id=r.created_by_user_id where r.proposal_id=$1 and r.status='active' order by r.created_at,r.id", [proposalId])).rows;
      // only active items, so a removed link shows as no item
      const items = table => req.database.query(`select id,title from ${table} where proposal_id=$1 and status='active' order by title,id`, [proposalId]).then(result => result.rows);
      const [tasks, events, workstreams, milestones] = await Promise.all([items("tasks"), items("schedule_events"), items("schedule_workstreams"), items("schedule_milestones")]);
      const linkable = { tasks, events, workstreams, milestones };
      const linkedItem = discussion => {
        if (!discussion.linked_kind) return null;
        const item = linkable[linkLists[discussion.linked_kind]].find(row => row.id === discussion.linked_id);
        return item ? { kind: discussion.linked_kind, id: item.id, title: item.title } : null;
      };
      res.json({
        current_user_id: req.userId, can_create: canCreateDiscussion(actor, proposal), linkable,
        discussions: discussions.map(discussion => {
          const own = replies.filter(reply => reply.discussion_id === discussion.id).map(reply => ({ ...reply, can_edit: canEditReply(actor, proposal, discussion, reply), can_remove: canRemoveReply(actor, proposal, discussion, reply) }));
          return {
            ...discussion, linked_item: linkedItem(discussion), reply_count: own.length, replies: own,
            can_edit: canEditDiscussion(actor, proposal, discussion), can_remove: canRemoveDiscussion(actor, proposal, discussion), can_reply: canReplyToDiscussion(actor, proposal, discussion),
          };
        }),
      });
    } catch (error) {
      console.error("discussion read failed", error);
      res.status(500).json({ error: "Could not load discussions." });
    }
  });

  async function change(req, res, action) {
    // ids are compared as text later, so use one lowercase form everywhere
    const proposalId = req.params.proposalId?.toLowerCase(), discussionId = req.params.discussionId?.toLowerCase(), replyId = req.params.replyId?.toLowerCase();
    if (!uuid.test(proposalId) || (discussionId && !uuid.test(discussionId)) || (replyId && !uuid.test(replyId))) return res.status(404).json({ error: "Discussion not found." });
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    let c;
    try {
      c = await req.database.connect();
      await c.query("begin");
      const fail = async (status, error) => { await c.query("rollback"); return res.status(status).json({ error }); };
      await c.query("select id from proposals where id=$1 for update", [proposalId]);
      const { actor, proposal } = await loadDiscussionPermissionContext(c, proposalId, req.userId);
      if (!canReadDiscussions(actor, proposal)) return await fail(403, "You do not have access to this proposal.");
      if (!canWriteDiscussions(actor, proposal)) return await fail(403, "Viewers cannot change discussions.");
      const discussion = discussionId ? (await c.query("select * from discussions where id=$1 and proposal_id=$2 and status='active' for update", [discussionId, proposalId])).rows[0] : null;
      if (discussionId && !discussion) return await fail(404, "Discussion not found.");
      const reply = replyId ? (await c.query("select * from discussion_replies where id=$1 and discussion_id=$2 and proposal_id=$3 and status='active' for update", [replyId, discussionId, proposalId])).rows[0] : null;
      if (replyId && !reply) return await fail(404, "Reply not found.");

      if (action === "create") {
        if (!canCreateDiscussion(actor, proposal)) return await fail(403, "You cannot start discussions in this proposal.");
        const title = cleanTitle(body.title), text = cleanBody(body.body), link = readLink(body);
        if (title === null || text === null || link === null) return await fail(400, "Enter a title up to 200 characters, a message up to 10,000 characters, and an optional valid link.");
        if (link.kind && !(await linkIsActive(c, proposalId, link))) return await fail(400, "Choose an active task, event, workstream or milestone in this proposal.");
        const id = randomUUID();
        await c.query("insert into discussions(id,proposal_id,partner_id,created_by_user_id,title,body,linked_kind,linked_id,updated_by_user_id) values($1,$2,$3,$4,$5,$6,$7,$8,$4)", [id, proposalId, actor.partner_id, req.userId, title, text, link.kind, link.id]);
        await auditDiscussionEvent(c, proposalId, req.userId, "discussion.created", id, { title, linked_kind: link.kind });
        await c.query("commit");
        return res.status(201).json({ id });
      }

      if (action === "update") {
        if (!canEditDiscussion(actor, proposal, discussion)) return await fail(403, "You can only edit your own discussions.");
        const title = Object.hasOwn(body, "title") ? cleanTitle(body.title) : discussion.title;
        const text = Object.hasOwn(body, "body") ? cleanBody(body.body) : discussion.body;
        // linkKind decides whether the link is sent, linkId goes with it
        const link = Object.hasOwn(body, "linkKind") ? readLink(body) : { kind: discussion.linked_kind, id: discussion.linked_id };
        if (title === null || text === null || link === null) return await fail(400, "Enter a title up to 200 characters, a message up to 10,000 characters, and an optional valid link.");
        const linkChanged = link.kind !== discussion.linked_kind || link.id !== discussion.linked_id;
        // only a new link is checked, an old link to a since-removed item stays as history
        if (linkChanged && link.kind && !(await linkIsActive(c, proposalId, link))) return await fail(400, "Choose an active task, event, workstream or milestone in this proposal.");
        const changes = [];
        if (title !== discussion.title) changes.push("title");
        if (text !== discussion.body) changes.push("body");
        if (linkChanged) changes.push("link");
        if (changes.length) {
          await c.query("update discussions set title=$1,body=$2,updated_by_user_id=$3,updated_at=now() where id=$4 and proposal_id=$5", [title, text, req.userId, discussionId, proposalId]);
          // the link trigger runs on any write to these columns, so only send them when they change
          if (linkChanged) await c.query("update discussions set linked_kind=$1,linked_id=$2 where id=$3 and proposal_id=$4", [link.kind, link.id, discussionId, proposalId]);
          await auditDiscussionEvent(c, proposalId, req.userId, "discussion.updated", discussionId, { fields: changes });
        }
        await c.query("commit");
        return res.json({ id: discussionId });
      }

      if (action === "remove") {
        if (!canRemoveDiscussion(actor, proposal, discussion)) return await fail(403, "You cannot remove this discussion.");
        // replies go with the discussion, but keep their rows with removal details
        const removedReplies = await c.query("update discussion_replies set status='removed',removed_at=now(),removed_by_user_id=$1,updated_by_user_id=$1,updated_at=now() where discussion_id=$2 and proposal_id=$3 and status='active'", [req.userId, discussionId, proposalId]);
        await c.query("update discussions set status='removed',removed_at=now(),removed_by_user_id=$1,updated_by_user_id=$1,updated_at=now() where id=$2 and proposal_id=$3", [req.userId, discussionId, proposalId]);
        await auditDiscussionEvent(c, proposalId, req.userId, "discussion.removed", discussionId, { title: discussion.title, reply_count: removedReplies.rowCount });
        await c.query("commit");
        return res.json({ id: discussionId });
      }

      if (action === "reply") {
        if (!canReplyToDiscussion(actor, proposal, discussion)) return await fail(403, "You cannot reply in this proposal.");
        const text = cleanBody(body.body);
        if (text === null) return await fail(400, "Enter a reply up to 10,000 characters.");
        const id = randomUUID();
        await c.query("insert into discussion_replies(id,proposal_id,discussion_id,partner_id,created_by_user_id,body,updated_by_user_id) values($1,$2,$3,$4,$5,$6,$5)", [id, proposalId, discussionId, actor.partner_id, req.userId, text]);
        await auditDiscussionEvent(c, proposalId, req.userId, "discussion.reply_created", discussionId, { reply_id: id });
        await c.query("commit");
        return res.status(201).json({ id });
      }

      if (action === "reply_update") {
        if (!canEditReply(actor, proposal, discussion, reply)) return await fail(403, "You can only edit your own replies.");
        const text = cleanBody(body.body);
        if (text === null) return await fail(400, "Enter a reply up to 10,000 characters.");
        await c.query("update discussion_replies set body=$1,updated_by_user_id=$2,updated_at=now() where id=$3 and proposal_id=$4", [text, req.userId, replyId, proposalId]);
        await auditDiscussionEvent(c, proposalId, req.userId, "discussion.reply_updated", discussionId, { reply_id: replyId });
        await c.query("commit");
        return res.json({ id: replyId });
      }

      if (action === "reply_remove") {
        if (!canRemoveReply(actor, proposal, discussion, reply)) return await fail(403, "You cannot remove this reply.");
        await c.query("update discussion_replies set status='removed',removed_at=now(),removed_by_user_id=$1,updated_by_user_id=$1,updated_at=now() where id=$2 and proposal_id=$3", [req.userId, replyId, proposalId]);
        await auditDiscussionEvent(c, proposalId, req.userId, "discussion.reply_removed", discussionId, { reply_id: replyId });
        await c.query("commit");
        return res.json({ id: replyId });
      }
      return await fail(500, "Unknown discussion action.");
    } catch (error) {
      if (c) await c.query("rollback").catch(() => {});
      console.error("discussion change failed", error);
      res.status(500).json({ error: "Could not save discussion." });
    } finally { c?.release(); }
  }

  app.post(base, (req, res) => change(req, res, "create"));
  app.patch(`${base}/:discussionId`, (req, res) => change(req, res, "update"));
  app.delete(`${base}/:discussionId`, (req, res) => change(req, res, "remove"));
  app.post(`${base}/:discussionId/replies`, (req, res) => change(req, res, "reply"));
  app.patch(`${base}/:discussionId/replies/:replyId`, (req, res) => change(req, res, "reply_update"));
  app.delete(`${base}/:discussionId/replies/:replyId`, (req, res) => change(req, res, "reply_remove"));
}
