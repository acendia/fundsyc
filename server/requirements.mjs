import { randomUUID } from "node:crypto";
import { loadRequirementPermissionContext, canReadRequirements, canManageRequirements } from "./requirement-permissions.mjs";
import { deriveRequirement, summarize } from "./requirement-progress.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// only strings count, arrays would otherwise match the regex after coercion
const validUuid = value => typeof value === "string" && uuid.test(value);
const lower = value => typeof value === "string" ? value.toLowerCase() : undefined;
// the version is the exact microsecond text postgres stores, javascript dates only keep milliseconds
const versionPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/;
const categories = ["eligibility", "administrative", "submission"];
const priorities = ["low", "medium", "high", "urgent"];
const maxTasks = 100;
const versionSql = "to_char(r.updated_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US')";

function validDate(value) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// trimmed, counted in characters like the database check
function cleanTitle(value) {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title && [...title].length <= 200 ? title : null;
}

// undefined means invalid, null means empty
function cleanDescription(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return [...text].length <= 10000 ? text || null : undefined;
}

// audit rows only hold ids and field names, not the text people wrote
async function auditRequirementEvent(client, proposalId, userId, action, requirementId, metadata = {}) {
  await client.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,$3,$4,'requirement',$5,$6)", [randomUUID(), proposalId, userId, action, requirementId, JSON.stringify(metadata)]);
}

const categoryOrder = "case r.category when 'eligibility' then 0 when 'administrative' then 1 else 2 end";
const priorityOrder = "case r.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end";

// requirements in the default order: stage, earliest deadline, priority, then the stable number
// $1 is the proposal and $2 the optional requirement, the overview reuses this sql in its batch
export const requirementRowsSql = (onlyId = false) => `select r.id,r.requirement_number,r.title,r.description,r.category,r.owner_user_id,r.partner_id,r.due_date::text as due_date,r.priority,r.manual_completed,r.created_at,r.updated_at,${versionSql} as version,
      o.display_name as owner_name,org.legal_name as partner_name,cu.display_name as created_by_name,uu.display_name as updated_by_name,
      case
        when r.owner_user_id is not null then exists(select 1 from proposal_memberships m join users u on u.id=m.user_id join consortium_partners p on p.id=m.partner_id and p.proposal_id=m.proposal_id where m.proposal_id=r.proposal_id and m.user_id=r.owner_user_id and m.partner_id=r.partner_id and m.status='active' and u.status='active' and p.status='active')
        when r.partner_id is not null then exists(select 1 from consortium_partners p where p.id=r.partner_id and p.proposal_id=r.proposal_id and p.status='active')
        else true
      end as responsible_active
    from requirements r
    left join users o on o.id=r.owner_user_id
    left join consortium_partners cp on cp.id=r.partner_id and cp.proposal_id=r.proposal_id
    left join organizations org on org.id=cp.organization_id
    join users cu on cu.id=r.created_by_user_id
    join users uu on uu.id=r.updated_by_user_id
    where r.proposal_id=$1 and r.status='active' ${onlyId ? "and r.id=$2" : ""}
    order by ${categoryOrder},r.due_date nulls last,${priorityOrder},r.requirement_number`;
export const requirementLinksSql = (onlyId = false) => `select l.requirement_id,t.id,t.title,t.progress,t.status
    from requirement_tasks l join tasks t on t.id=l.task_id and t.proposal_id=l.proposal_id
    where l.proposal_id=$1 and l.status='active' ${onlyId ? "and l.requirement_id=$2" : ""}
    order by t.title,t.id`;

export async function loadRequirements(db, proposalId, today, onlyId = null) {
  const params = onlyId ? [proposalId, onlyId] : [proposalId];
  const rows = (await db.query(requirementRowsSql(Boolean(onlyId)), params)).rows;
  const links = (await db.query(requirementLinksSql(Boolean(onlyId)), params)).rows;
  return buildRequirements(rows, links, today);
}

// joins the links to their requirement and adds the derived progress
export function buildRequirements(rows, links, today) {
  return rows.map(row => {
    const tasks = links.filter(link => link.requirement_id === row.id).map(({ requirement_id, ...task }) => task);
    const { manual_completed, responsible_active, ...shown } = row;
    return { ...shown, code: `REQ-${String(row.requirement_number).padStart(3, "0")}`, tasks, ...deriveRequirement(row, tasks, today) };
  });
}

// the day the person sees, so overdue does not flip at the wrong hour
function readToday(query) {
  return validDate(query.today) ? query.today : new Date().toISOString().slice(0, 10);
}

export function addRequirementRoutes(app) {
  const base = "/api/proposals/:proposalId/requirements";
  app.use(base, (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });

  // reads use one snapshot, so rows, tasks and counts always belong together
  async function read(req, res, requirementId) {
    const proposalId = lower(req.params.proposalId);
    if (!validUuid(proposalId)) return res.status(404).json({ error: "Proposal not found." });
    if (requirementId !== null && !validUuid(requirementId)) return res.status(404).json({ error: "Requirement not found." });
    let c;
    try {
      c = await req.database.connect();
      await c.query("begin isolation level repeatable read read only");
      const { actor, proposal } = await loadRequirementPermissionContext(c, proposalId, req.userId);
      if (!canReadRequirements(actor, proposal)) { await c.query("rollback"); return res.status(403).json({ error: "You do not have access to this proposal." }); }
      const today = readToday(req.query);
      const can = canManageRequirements(actor, proposal);
      const withFlags = item => ({ ...item, can_edit: can, can_remove: can, can_complete: can });
      const head = { proposal: { id: proposal.id, status: proposal.status }, current_user_id: req.userId, can_manage: can };
      if (requirementId) {
        const [item] = await loadRequirements(c, proposalId, today, requirementId);
        await c.query("commit");
        return item ? res.json({ ...head, requirement: withFlags(item) }) : res.status(404).json({ error: "Requirement not found." });
      }
      const items = await loadRequirements(c, proposalId, today);
      const owners = can ? (await c.query("select m.user_id,u.display_name,o.legal_name as partner_name from proposal_memberships m join users u on u.id=m.user_id join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id join organizations o on o.id=cp.organization_id where m.proposal_id=$1 and m.status='active' and m.access_role<>'viewer' and u.status='active' and cp.status='active' order by u.display_name,m.user_id", [proposalId])).rows : [];
      const partners = can ? (await c.query("select cp.id,o.legal_name from consortium_partners cp join organizations o on o.id=cp.organization_id where cp.proposal_id=$1 and cp.status='active' order by o.legal_name,cp.id", [proposalId])).rows : [];
      const tasks = can ? (await c.query("select id,title,progress from tasks where proposal_id=$1 and status='active' order by title,id", [proposalId])).rows : [];
      await c.query("commit");
      res.json({ ...head, owners, partners, linkable_tasks: tasks, summary: summarize(items), requirements: items.map(withFlags) });
    } catch (error) {
      if (c) await c.query("rollback").catch(() => {});
      console.error("requirement read failed", error);
      res.status(500).json({ error: "Could not load requirements." });
    } finally { c?.release(); }
  }
  app.get(base, (req, res) => read(req, res, null));
  app.get(`${base}/:requirementId`, (req, res) => read(req, res, lower(req.params.requirementId)));

  // every write locks the proposal first, like tasks do, so a task change cannot race a completion
  async function change(req, res, action) {
    const proposalId = lower(req.params.proposalId), requirementId = lower(req.params.requirementId);
    if (!validUuid(proposalId)) return res.status(404).json({ error: "Proposal not found." });
    if (requirementId !== undefined && !validUuid(requirementId)) return res.status(404).json({ error: "Requirement not found." });
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    let c;
    try {
      c = await req.database.connect();
      await c.query("begin");
      const fail = async (status, error, extra = {}) => { await c.query("rollback"); return res.status(status).json({ error, ...extra }); };
      await c.query("select id from proposals where id=$1 for update", [proposalId]);
      const { actor, proposal } = await loadRequirementPermissionContext(c, proposalId, req.userId);
      if (!canReadRequirements(actor, proposal)) return await fail(403, "You do not have access to this proposal.");
      if (!canManageRequirements(actor, proposal)) return await fail(["submitted", "archived"].includes(proposal.status) ? 409 : 403, "Only the proposal coordinator can change requirements while the proposal is editable.");
      const current = requirementId ? (await c.query(`select r.*,r.due_date::text as due_date,${versionSql} as version from requirements r where r.id=$1 and r.proposal_id=$2 and r.status='active' for update`, [requirementId, proposalId])).rows[0] : null;
      if (requirementId && !current) return await fail(404, "Requirement not found.");
      const links = current ? (await c.query("select l.task_id as id,t.title,t.progress,t.status from requirement_tasks l join tasks t on t.id=l.task_id and t.proposal_id=l.proposal_id where l.requirement_id=$1 and l.proposal_id=$2 and l.status='active'", [requirementId, proposalId])).rows : [];
      const currentTaskIds = links.map(link => link.id);

      if (action === "complete") {
        if (typeof body.completed !== "boolean") return await fail(400, "Send completed as true or false.");
        const derived = deriveRequirement(current, links, "0000-01-01");
        if (links.length) {
          // linked requirements follow their tasks, the checkbox cannot override them
          if (body.completed && !derived.completed) return await fail(409, "This requirement cannot be completed yet. Complete the linked tasks first.", { code: "unfinished_linked_tasks", unfinished_tasks: derived.unfinished_tasks, removed_tasks: derived.removed_tasks });
          if (!body.completed && derived.completed) return await fail(409, "This requirement is completed automatically because all linked tasks are completed. Reopen a linked task to change its completion.", { code: "automatically_completed" });
          await c.query("commit");
          return res.json({ id: requirementId, completed: derived.completed });
        }
        if (current.manual_completed !== body.completed) {
          await c.query("update requirements set manual_completed=$1,updated_by_user_id=$2,updated_at=clock_timestamp() where id=$3 and proposal_id=$4", [body.completed, req.userId, requirementId, proposalId]);
          await auditRequirementEvent(c, proposalId, req.userId, body.completed ? "requirement.completed" : "requirement.reopened", requirementId);
        }
        await c.query("commit");
        return res.json({ id: requirementId, completed: body.completed });
      }

      if (action === "remove") {
        await c.query("update requirements set status='removed',removed_at=now(),removed_by_user_id=$1,updated_by_user_id=$1,updated_at=clock_timestamp() where id=$2 and proposal_id=$3", [req.userId, requirementId, proposalId]);
        // only the links go, the tasks stay as they are
        await c.query("update requirement_tasks set status='removed',removed_at=now(),removed_by_user_id=$1 where requirement_id=$2 and proposal_id=$3 and status='active'", [req.userId, requirementId, proposalId]);
        await auditRequirementEvent(c, proposalId, req.userId, "requirement.removed", requirementId);
        await c.query("commit");
        return res.json({ id: requirementId });
      }

      // create and update share one validation, a missing key keeps the saved value
      const field = (key, existing) => Object.hasOwn(body, key) ? body[key] : existing;
      const title = cleanTitle(field("title", current?.title));
      const description = cleanDescription(field("description", current?.description));
      const category = field("category", current?.category);
      const priority = field("priority", current?.priority ?? "medium");
      let dueDate = field("dueDate", current?.due_date ?? null);
      if (dueDate === "") dueDate = null;
      if (title === null || description === undefined || !categories.includes(category) || !priorities.includes(priority) || (dueDate !== null && !validDate(dueDate))) return await fail(400, "Enter a title up to 200 characters, a category, a priority and an optional due date.");

      // an unchanged owner keeps its saved partner, so a history owner never blocks other edits
      let ownerId = current?.owner_user_id ?? null, partnerId = current?.partner_id ?? null;
      if (Object.hasOwn(body, "ownerUserId") || Object.hasOwn(body, "partnerId")) {
        const ownerIn = Object.hasOwn(body, "ownerUserId") ? (body.ownerUserId === "" ? null : body.ownerUserId) : ownerId;
        const partnerIn = Object.hasOwn(body, "partnerId") ? (body.partnerId === "" ? null : body.partnerId) : partnerId;
        if ((ownerIn !== null && !validUuid(ownerIn)) || (partnerIn !== null && !validUuid(partnerIn))) return await fail(400, "Choose a valid owner and institution.");
        if (ownerIn !== null) {
          const nextOwner = ownerIn.toLowerCase();
          if (nextOwner !== ownerId) {
            const member = (await c.query("select m.partner_id from proposal_memberships m join users u on u.id=m.user_id join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.user_id=$2 and m.status='active' and m.access_role<>'viewer' and u.status='active' and cp.status='active'", [proposalId, nextOwner])).rows[0];
            if (!member) return await fail(400, "Choose an active member who can own requirements.");
            ownerId = nextOwner; partnerId = member.partner_id;
          }
        } else {
          const nextPartner = partnerIn === null ? null : partnerIn.toLowerCase();
          if (nextPartner !== null && nextPartner !== partnerId) {
            const partner = await c.query("select 1 from consortium_partners where id=$1 and proposal_id=$2 and status='active'", [nextPartner, proposalId]);
            if (!partner.rowCount) return await fail(400, "Choose an active partner of this proposal.");
          }
          ownerId = null; partnerId = nextPartner;
        }
      }

      let wanted = currentTaskIds;
      if (Object.hasOwn(body, "taskIds")) {
        const list = body.taskIds;
        if (!Array.isArray(list) || list.length > maxTasks || !list.every(validUuid)) return await fail(400, "Choose valid tasks.");
        wanted = list.map(id => id.toLowerCase());
        if (new Set(wanted).size !== wanted.length) return await fail(400, "Choose each task only once.");
      }
      // only newly linked tasks must be active, a removed task that is already linked can stay until it is unlinked
      const added = wanted.filter(id => !currentTaskIds.includes(id));
      const dropped = currentTaskIds.filter(id => !wanted.includes(id));
      if (added.length) {
        const found = await c.query("select id from tasks where proposal_id=$1 and status='active' and id=any($2::uuid[])", [proposalId, added]);
        if (found.rowCount !== added.length) return await fail(400, "Choose active tasks of this proposal.");
      }

      if (!current) {
        const number = (await c.query("select coalesce(max(requirement_number),0)+1 as next from requirements where proposal_id=$1", [proposalId])).rows[0].next;
        const id = randomUUID();
        await c.query("insert into requirements(id,proposal_id,requirement_number,title,description,category,owner_user_id,partner_id,due_date,priority,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)", [id, proposalId, number, title, description, category, ownerId, partnerId, dueDate, priority, req.userId]);
        for (const taskId of added) await c.query("insert into requirement_tasks(id,proposal_id,requirement_id,task_id,created_by_user_id) values($1,$2,$3,$4,$5)", [randomUUID(), proposalId, id, taskId, req.userId]);
        await auditRequirementEvent(c, proposalId, req.userId, "requirement.created", id, { number, tasks: added.length });
        await c.query("commit");
        return res.status(201).json({ id, code: `REQ-${String(number).padStart(3, "0")}` });
      }

      // an edit form that was opened before someone else saved must not overwrite their work
      if (Object.hasOwn(body, "expectedVersion")) {
        if (typeof body.expectedVersion !== "string" || !versionPattern.test(body.expectedVersion)) return await fail(400, "Reload the requirement and try saving again.");
        if (body.expectedVersion !== current.version) return await fail(409, "Someone else saved this requirement after you opened it. Review the latest version, then edit again.", { code: "requirement_changed" });
      }
      const changed = [];
      if (title !== current.title) changed.push("title");
      if (description !== current.description) changed.push("description");
      if (category !== current.category) changed.push("category");
      if (priority !== current.priority) changed.push("priority");
      if (dueDate !== current.due_date) changed.push("due_date");
      const assignmentChanged = ownerId !== current.owner_user_id || partnerId !== current.partner_id;
      if (assignmentChanged) changed.push("owner");
      if (added.length || dropped.length) changed.push("tasks");
      if (!changed.length) { await c.query("commit"); return res.json({ id: requirementId }); }

      // the manual checkbox only means something without tasks, so moving in or out of task mode resets it
      const modeChanged = (currentTaskIds.length === 0) !== (wanted.length === 0);
      const sets = ["title=$1", "description=$2", "category=$3", "priority=$4", "due_date=$5", "updated_by_user_id=$6", "updated_at=clock_timestamp()"];
      const values = [title, description, category, priority, dueDate, req.userId];
      if (assignmentChanged) { values.push(ownerId, partnerId); sets.push(`owner_user_id=$${values.length - 1}`, `partner_id=$${values.length}`); }
      if (modeChanged) sets.push("manual_completed=false");
      values.push(requirementId, proposalId);
      await c.query(`update requirements set ${sets.join(",")} where id=$${values.length - 1} and proposal_id=$${values.length}`, values);
      if (dropped.length) await c.query("update requirement_tasks set status='removed',removed_at=now(),removed_by_user_id=$1 where requirement_id=$2 and proposal_id=$3 and status='active' and task_id=any($4::uuid[])", [req.userId, requirementId, proposalId, dropped]);
      for (const taskId of added) await c.query("insert into requirement_tasks(id,proposal_id,requirement_id,task_id,created_by_user_id) values($1,$2,$3,$4,$5)", [randomUUID(), proposalId, requirementId, taskId, req.userId]);
      await auditRequirementEvent(c, proposalId, req.userId, "requirement.updated", requirementId, { fields: changed });
      await c.query("commit");
      res.json({ id: requirementId });
    } catch (error) {
      if (c) await c.query("rollback").catch(() => {});
      // the database refused a write the api allowed, usually because the state changed meanwhile
      if (error.code === "23514" || error.code === "23505") return res.status(409).json({ error: "This requirement changed. Refresh and try again." });
      console.error("requirement change failed", error);
      res.status(500).json({ error: "Could not save this requirement." });
    } finally { c?.release(); }
  }
  app.post(base, (req, res) => change(req, res, "create"));
  app.patch(`${base}/:requirementId`, (req, res) => change(req, res, "update"));
  app.patch(`${base}/:requirementId/completion`, (req, res) => change(req, res, "complete"));
  app.delete(`${base}/:requirementId`, (req, res) => change(req, res, "remove"));
}
