import { addTaskActivityRoutes, auditTaskEvent } from "./task-activity.mjs";
import { randomUUID } from "node:crypto";
import { loadTaskPermissionContext, canReadTasks, canChangeTasks, canCreateTask, canEditTask, canAssignTask, canUpdateTask, canRemoveTask } from "./task-permissions.mjs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const progress = ["todo", "in_progress", "in_review", "completed"];
const priorities = ["low", "medium", "high", "urgent"];

export function addTaskRoutes(app) {
  addTaskActivityRoutes(app);
  const base = "/api/proposals/:proposalId/tasks";
  app.get(base, async (req, res) => {
    if (!uuid.test(req.params.proposalId)) return res.status(404).json({ error: "Proposal not found." });
    try {
      const { actor, proposal } = await loadTaskPermissionContext(req.database, req.params.proposalId, req.userId);
      if (!canReadTasks(actor, proposal)) return res.status(403).json({ error: "You do not have access to this proposal." });
      const partners = (await req.database.query("select cp.id,o.legal_name from consortium_partners cp join organizations o on o.id=cp.organization_id where cp.proposal_id=$1 and cp.status='active' order by o.legal_name,cp.id", [proposal.id])).rows;
      const members = (await req.database.query("select m.user_id,m.partner_id,u.display_name from proposal_memberships m join users u on u.id=m.user_id join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.status='active' and u.status='active' and cp.status='active' order by u.display_name,m.user_id", [proposal.id])).rows;
      const tasks = (await req.database.query("select t.*,w.title as workstream_title,w.status as workstream_status,t.due_date::text as due_date,o.legal_name as partner_name,u.display_name as assignee_name,a.display_name as created_by_name,b.display_name as updated_by_name,(select count(*)::int from task_comments c where c.proposal_id=t.proposal_id and c.task_id=t.id and c.status='active') as comment_count from tasks t left join schedule_workstreams w on w.id=t.workstream_id and w.proposal_id=t.proposal_id join consortium_partners cp on cp.id=t.partner_id and cp.proposal_id=t.proposal_id join organizations o on o.id=cp.organization_id left join users u on u.id=t.assignee_user_id join users a on a.id=t.created_by_user_id join users b on b.id=t.updated_by_user_id where t.proposal_id=$1 and t.status='active' order by t.created_at desc,t.id", [proposal.id])).rows;
      const workstreams = (await req.database.query("select id,title from schedule_workstreams where proposal_id=$1 and status='active' order by title,id", [proposal.id])).rows;
      res.json({ workstreams, proposal, current_user_id: req.userId, can_assign_new: actor.access_role !== "contributor", can_add: canChangeTasks(actor, proposal) && partners.some(p => canCreateTask(actor, proposal, { proposal_id: proposal.id, partner_id: p.id, assignee_user_id: req.userId, status: "active" })), partners: partners.map(p => ({ ...p, can_create: canCreateTask(actor, proposal, { proposal_id: proposal.id, partner_id: p.id, assignee_user_id: req.userId, status: "active" }), members: members.filter(m => m.partner_id === p.id) })), tasks: tasks.map(t => ({ ...t, can_edit: canEditTask(actor, proposal, t), can_remove: canRemoveTask(actor, proposal, t), can_assign: canAssignTask(actor, proposal, t) })) });
    } catch (error) { console.error("task read failed", error); res.status(500).json({ error: "Could not load tasks." }); }
  });

  async function save(req, res, action) {
    const { proposalId, taskId } = req.params;
    if (!uuid.test(proposalId) || (taskId && !uuid.test(taskId))) return res.status(404).json({ error: "Task not found." });
    let c;
    try {
      c = await req.database.connect(); await c.query("begin");
      await c.query("select id from proposals where id=$1 for update", [proposalId]);
      const { actor, proposal } = await loadTaskPermissionContext(c, proposalId, req.userId);
      const fail = async (code, error) => { await c.query("rollback"); return res.status(code).json({ error }); };
      if (!canReadTasks(actor, proposal)) return await fail(403, "You do not have access to this proposal.");
      if (!canChangeTasks(actor, proposal)) return await fail(["submitted", "archived"].includes(proposal.status) ? 409 : 403, "You cannot change tasks in this proposal.");
      const current = taskId ? (await c.query("select *,due_date::text as due_date from tasks where id=$1 and proposal_id=$2 and status='active' for update", [taskId, proposalId])).rows[0] : null;
      if (taskId && !current) return await fail(404, "Task not found.");
      const id = taskId ?? randomUUID();
      let metadata = {};
      if (action === "remove") {
        if (!canRemoveTask(actor, proposal, current)) return await fail(403, "You cannot remove this task.");
        metadata = { title: current.title };
        await c.query("update tasks set status='removed',removed_at=now(),removed_by_user_id=$1,updated_by_user_id=$1,updated_at=now() where id=$2 and proposal_id=$3", [req.userId, id, proposalId]);
      } else {
        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) return await fail(400, "Enter valid task information.");
        const field = (key, existing, fallback) => Object.hasOwn(body, key) ? body[key] : existing ?? fallback;
        const next = { ...current, id, proposal_id: proposalId, status: "active", title: field("title", current?.title, ""), description: field("description", current?.description, null), partner_id: field("partnerId", current?.partner_id, null), assignee_user_id: field("assigneeUserId", current?.assignee_user_id, null), progress: field("progress", current?.progress, "todo"), priority: field("priority", current?.priority, "medium"), due_date: field("dueDate", current?.due_date, null), workstream_id: field("workstreamId", current?.workstream_id, null) };
        if (next.assignee_user_id === "") next.assignee_user_id = null;
        if (next.workstream_id === "") next.workstream_id = null;
        if (next.workstream_id !== null && !uuid.test(next.workstream_id)) return await fail(400, "Choose a valid workstream.");
        if (next.due_date === "") next.due_date = null;
        let validDate = next.due_date === null;
        if (typeof next.due_date === "string" && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(next.due_date)) { const date = new Date(next.due_date); validDate = !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === next.due_date; }
        if (typeof next.title !== "string" || !next.title.trim() || (next.description !== null && typeof next.description !== "string") || !uuid.test(next.partner_id ?? "") || (next.assignee_user_id !== null && !uuid.test(next.assignee_user_id)) || !progress.includes(next.progress) || !priorities.includes(next.priority) || !validDate) return await fail(400, "Enter a title, partner, valid progress, priority and optional due date.");
        const assignmentChanged = !current || next.partner_id !== current.partner_id || next.assignee_user_id !== current.assignee_user_id;
        if (current ? !canUpdateTask(actor, proposal, current, next) : !canCreateTask(actor, proposal, next)) return await fail(403, "You cannot edit or assign this task.");
        if (assignmentChanged) {
          const activePartner = await c.query("select 1 from consortium_partners where id=$1 and proposal_id=$2 and status='active'", [next.partner_id, proposalId]);
          if (!activePartner.rowCount) return await fail(400, "Choose an active proposal partner.");
          if (next.assignee_user_id) {
            const member = await c.query("select 1 from proposal_memberships m join users u on u.id=m.user_id where m.proposal_id=$1 and m.partner_id=$2 and m.user_id=$3 and m.status='active' and u.status='active'", [proposalId, next.partner_id, next.assignee_user_id]);
            if (!member.rowCount) return await fail(400, "Choose an active member of this partner.");
          }
        }
        const workstreamChanged = !current || next.workstream_id !== current.workstream_id;
        if (workstreamChanged && next.workstream_id) {
          const workstream = await c.query("select 1 from schedule_workstreams where id=$1 and proposal_id=$2 and status='active'", [next.workstream_id, proposalId]);
          if (!workstream.rowCount) return await fail(400, "Choose an active workstream in this proposal.");
        }
        const changes = {};
        next.title = next.title.trim();
        next.description = next.description?.trim() || null;
        for (const field of ["title", "description", "priority", "due_date"]) {
          if (current && current[field] !== next[field]) changes[field] = { before: current[field], after: next[field] };
        }
        if (current && workstreamChanged) {
          const linked = await c.query("select id,title from schedule_workstreams where proposal_id=$1 and id=any($2::uuid[])", [proposalId, [current.workstream_id, next.workstream_id].filter(Boolean)]);
          const name = id => linked.rows.find(row => row.id === id)?.title ?? null;
          changes.workstream = { before: name(current.workstream_id), after: name(next.workstream_id) };
        }
        metadata = current ? { changes } : { title: next.title };
        if (!current) await c.query("insert into tasks(id,proposal_id,partner_id,title,description,progress,priority,assignee_user_id,assigned_by_user_id,assigned_at,due_date,created_by_user_id,updated_by_user_id,workstream_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13)", [id, proposalId, next.partner_id, next.title.trim(), next.description?.trim() || null, next.progress, next.priority, next.assignee_user_id, next.assignee_user_id ? req.userId : null, next.assignee_user_id ? new Date() : null, next.due_date, req.userId, next.workstream_id]);
        else {
          await c.query("update tasks set title=$1,description=$2,progress=$3,priority=$4,due_date=$5,updated_by_user_id=$6,updated_at=now() where id=$7 and proposal_id=$8", [next.title.trim(), next.description?.trim() || null, next.progress, next.priority, next.due_date, req.userId, id, proposalId]);
          if (workstreamChanged) await c.query("update tasks set workstream_id=$1 where id=$2 and proposal_id=$3", [next.workstream_id, id, proposalId]);
          // leave old assignment dates alone when only editing task information
          if (assignmentChanged) await c.query("update tasks set partner_id=$1,assignee_user_id=$2,assigned_by_user_id=$3,assigned_at=$4 where id=$5 and proposal_id=$6", [next.partner_id, next.assignee_user_id, next.assignee_user_id ? req.userId : null, next.assignee_user_id ? new Date() : null, id, proposalId]);
          if (assignmentChanged) {
            const names = async (value) => {
              const result = await c.query("select o.legal_name as partner,u.display_name as assignee from consortium_partners cp join organizations o on o.id=cp.organization_id left join users u on u.id=$2 where cp.id=$1", [value.partner_id, value.assignee_user_id]);
              return result.rows[0];
            };
            await auditTaskEvent(c, proposalId, req.userId, "task.reassigned", id, { before: await names(current), after: await names(next) });
          }
          if (current.progress !== next.progress) await auditTaskEvent(c, proposalId, req.userId, "task.progress_changed", id, { before: current.progress, after: next.progress });
        }
      }
      if (action !== "update" || Object.keys(metadata.changes).length > 0) await auditTaskEvent(c, proposalId, req.userId, `task.${action === "create" ? "created" : action === "remove" ? "removed" : "updated"}`, id, metadata);
      await c.query("commit"); res.status(action === "create" ? 201 : 200).json({ id });
    } catch (error) { if (c) await c.query("rollback").catch(() => {}); console.error("task save failed", error); res.status(500).json({ error: "Could not save task." }); }
    finally { c?.release(); }
  }
  app.post(base, (req, res) => save(req, res, "create"));
  app.patch(`${base}/:taskId`, (req, res) => save(req, res, "update"));
  app.delete(`${base}/:taskId`, (req, res) => save(req, res, "remove"));
}
