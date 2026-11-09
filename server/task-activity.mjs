import { randomUUID } from "node:crypto";
import { loadTaskPermissionContext, canReadTasks, canCommentOnTask, canEditTaskComment, canRemoveTaskComment } from "./task-permissions.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function auditTaskEvent(client, proposalId, userId, action, taskId, metadata = {}) {
  await client.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,$3,$4,'task',$5,$6)", [randomUUID(), proposalId, userId, action, taskId, JSON.stringify(metadata)]);
}

export function addTaskActivityRoutes(app) {
  const base = "/api/proposals/:proposalId/tasks/:taskId";
  app.get(`${base}/activity`, async (req, res) => {
    const { proposalId, taskId } = req.params;
    if (![proposalId, taskId].every(id => uuid.test(id))) return res.status(404).json({ error: "Task not found." });
    try {
      const { actor, proposal } = await loadTaskPermissionContext(req.database, proposalId, req.userId);
      if (!canReadTasks(actor, proposal)) return res.status(403).json({ error: "You do not have access to this proposal." });
      const task = (await req.database.query("select * from tasks where id=$1 and proposal_id=$2 and status='active'", [taskId, proposalId])).rows[0];
      if (!task) return res.status(404).json({ error: "Task not found." });
      const comments = (await req.database.query("select c.id,c.proposal_id,c.task_id,c.author_user_id,c.status,case when c.status='active' then c.body else null end as body,c.created_at,c.updated_at,c.removed_at,u.display_name as author_name from task_comments c join users u on u.id=c.author_user_id where c.proposal_id=$1 and c.task_id=$2 order by c.created_at,c.id", [proposalId, taskId])).rows;
      const history = (await req.database.query("select e.id,e.action,e.metadata,e.created_at,coalesce(u.display_name,'Unknown user') as actor_name from audit_events e left join users u on u.id=e.actor_user_id where e.proposal_id=$1 and e.entity_type='task' and e.entity_id=$2 order by e.created_at desc,e.id desc", [proposalId, taskId])).rows;
      res.set("Cache-Control", "private, no-store");
      res.json({ can_comment: canCommentOnTask(actor, proposal, task), comments: comments.map(comment => ({ ...comment, can_edit: canEditTaskComment(actor, proposal, task, comment), can_remove: canRemoveTaskComment(actor, proposal, task, comment) })), history });
    } catch (error) {
      console.error("task activity read failed", error);
      res.status(500).json({ error: "Could not load task comments and history." });
    }
  });

  async function changeComment(req, res, action) {
    const { proposalId, taskId, commentId } = req.params;
    if (![proposalId, taskId, ...(commentId ? [commentId] : [])].every(id => uuid.test(id))) return res.status(404).json({ error: "Comment not found." });
    const body = req.body?.body;
    if (action !== "remove" && (typeof body !== "string" || !body.trim() || body.trim().length > 10000)) return res.status(400).json({ error: "Enter a comment of up to 10,000 characters." });
    let client;
    try {
      client = await req.database.connect();
      await client.query("begin");
      const fail = async (status, error) => { await client.query("rollback"); return res.status(status).json({ error }); };
      await client.query("select id from proposals where id=$1 for update", [proposalId]);
      const { actor, proposal } = await loadTaskPermissionContext(client, proposalId, req.userId);
      if (!canReadTasks(actor, proposal)) return await fail(403, "You do not have access to this proposal.");
      const task = (await client.query("select * from tasks where id=$1 and proposal_id=$2 and status='active' for update", [taskId, proposalId])).rows[0];
      if (!task) return await fail(404, "Task not found.");
      if (!canCommentOnTask(actor, proposal, task)) return await fail(["submitted", "archived"].includes(proposal.status) ? 409 : 403, "You cannot change comments in this proposal.");
      const comment = commentId ? (await client.query("select * from task_comments where id=$1 and task_id=$2 and proposal_id=$3 and status='active' for update", [commentId, taskId, proposalId])).rows[0] : null;
      if (commentId && !comment) return await fail(404, "Comment not found.");
      if (action === "edit" && !canEditTaskComment(actor, proposal, task, comment)) return await fail(403, "You can only edit your own comments.");
      if (action === "remove" && !canRemoveTaskComment(actor, proposal, task, comment)) return await fail(403, "You cannot remove this comment.");
      const id = commentId ?? randomUUID();
      if (action === "add") await client.query("insert into task_comments(id,proposal_id,task_id,author_user_id,body) values($1,$2,$3,$4,$5)", [id, proposalId, taskId, req.userId, body.trim()]);
      if (action === "edit") await client.query("update task_comments set body=$1,updated_at=now() where id=$2", [body.trim(), id]);
      if (action === "remove") await client.query("update task_comments set status='removed',removed_at=now(),removed_by_user_id=$1,updated_at=now() where id=$2", [req.userId, id]);
      await auditTaskEvent(client, proposalId, req.userId, `task.comment_${{ add: "added", edit: "edited", remove: "removed" }[action]}`, taskId, { comment_id: id });
      await client.query("commit");
      res.status(action === "add" ? 201 : 200).json({ id });
    } catch (error) {
      if (client) await client.query("rollback").catch(() => {});
      console.error("task comment change failed", error);
      res.status(500).json({ error: "Could not save comment." });
    } finally { client?.release(); }
  }
  app.post(`${base}/comments`, (req, res) => changeComment(req, res, "add"));
  app.patch(`${base}/comments/:commentId`, (req, res) => changeComment(req, res, "edit"));
  app.delete(`${base}/comments/:commentId`, (req, res) => changeComment(req, res, "remove"));
}
