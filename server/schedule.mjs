import { randomUUID } from "node:crypto";
import {
  loadSchedulePermissionContext, canReadSchedule, canChangeSchedule,
  canManageTimelineItem, canUpdateTimelineItem, canManageScheduleEvent, canUpdateScheduleEvent,
} from "./schedule-permissions.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const progress = ["planned", "in_progress", "at_risk", "completed"];
const kinds = {
  workstreams: { table: "schedule_workstreams", entity: "schedule_workstream", columns: ["title", "description", "lead_partner_id", "start_date", "end_date", "progress"] },
  milestones: { table: "schedule_milestones", entity: "schedule_milestone", columns: ["title", "description", "lead_partner_id", "due_date", "progress"] },
  events: { table: "schedule_events", entity: "schedule_event", columns: ["title", "notes", "partner_id", "organizer_user_id", "workstream_id", "event_type", "event_date", "all_day", "starts_at", "ends_at", "time_zone"] },
};

function validDate(value) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// find every matching instant so a repeated clock time needs an explicit choice
async function eventInstant(database, date, time, zone, occurrence, previous) {
  if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw invalid("Enter a valid event time.");
  }
  if (occurrence != null && !["", "earlier", "later"].includes(occurrence)) throw invalid("Choose a valid clock-change occurrence.");
  const local = date + " " + time + ":00";
  const result = await database.query(`
    with offsets as (
      select distinct (instant at time zone $2) - (instant at time zone 'UTC') as utc_offset
      from generate_series(($1::timestamp at time zone 'UTC') - interval '36 hours',
        ($1::timestamp at time zone 'UTC') + interval '36 hours', interval '6 hours') as instant
    ), candidates as (
      select ($1::timestamp - utc_offset) at time zone 'UTC' as instant from offsets
    )
    select instant from candidates where instant at time zone $2 = $1::timestamp order by instant
  `, [local, zone]);
  const candidates = result.rows.map(row => row.instant.toISOString());
  if (!candidates.length) throw invalid("This time does not exist because of a clock change. Choose another time.");
  if (candidates.length === 1) return candidates[0];
  if (occurrence === "earlier") return candidates[0];
  if (occurrence === "later") return candidates[candidates.length - 1];
  const saved = previous ? new Date(previous).toISOString() : null;
  if (candidates.includes(saved)) return saved;
  throw invalid("This time occurs twice because of a clock change. Choose the earlier or later occurrence.");
}

const dateColumns = kind => kind === "events" ? "s.event_date::text as event_date, to_char(s.starts_at at time zone s.time_zone,'HH24:MI') as start_time, to_char(s.ends_at at time zone s.time_zone,'HH24:MI') as end_time"
  : kind === "workstreams" ? "s.start_date::text as start_date,s.end_date::text as end_date" : "s.due_date::text as due_date";

export function addScheduleRoutes(app) {
  const base = "/api/proposals/:proposalId/schedule";
  app.get(base, async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    if (!uuid.test(req.params.proposalId)) return res.status(404).json({ error: "Proposal not found." });
    try {
      const { actor, proposal } = await loadSchedulePermissionContext(req.database, req.params.proposalId, req.userId);
      if (!canReadSchedule(actor, proposal)) return res.status(403).json({ error: "You do not have access to this proposal." });
      const partners = (await req.database.query("select cp.id,o.legal_name from consortium_partners cp join organizations o on o.id=cp.organization_id where cp.proposal_id=$1 and cp.status='active' order by o.legal_name,cp.id", [proposal.id])).rows;
      const members = (await req.database.query("select m.user_id,m.partner_id,u.display_name from proposal_memberships m join users u on u.id=m.user_id join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.status='active' and cp.status='active' and u.status='active' order by u.display_name,m.user_id", [proposal.id])).rows;
      const data = {};
      for (const [kind, config] of Object.entries(kinds)) {
        const partnerColumn = kind === "events" ? "partner_id" : "lead_partner_id";
        const organizer = kind === "events" ? "left join users organizer on organizer.id=s.organizer_user_id" : "";
        const rows = (await req.database.query(`select s.*, ${dateColumns(kind)}, o.legal_name as partner_name,
          creator.display_name as created_by_name, updater.display_name as updated_by_name
          ${kind === "events" ? ",organizer.display_name as organizer_name" : ""}
          from ${config.table} s join consortium_partners cp on cp.id=s.${partnerColumn} and cp.proposal_id=s.proposal_id
          join organizations o on o.id=cp.organization_id join users creator on creator.id=s.created_by_user_id
          join users updater on updater.id=s.updated_by_user_id ${organizer}
          where s.proposal_id=$1 and s.status='active'
          order by s.${kind === "events" ? "event_date" : kind === "workstreams" ? "start_date" : "due_date"},s.id`, [proposal.id])).rows;
        const canManage = kind === "events" ? canManageScheduleEvent : canManageTimelineItem;
        data[kind] = rows.map(item => ({ ...item, can_edit: canManage(actor, proposal, item), can_remove: canManage(actor, proposal, item) }));
      }
      res.json({
        ...data, proposal, current_user_id: req.userId,
        partners: partners.map(partner => ({
          ...partner,
          can_add_timeline: canManageTimelineItem(actor, proposal, { proposal_id: proposal.id, lead_partner_id: partner.id, status: "active" }),
          members: members.filter(member => member.partner_id === partner.id).map(member => ({
            ...member, can_organize: canManageScheduleEvent(actor, proposal, { proposal_id: proposal.id, partner_id: partner.id, organizer_user_id: member.user_id, status: "active" }),
          })),
        })),
      });
    } catch (error) {
      console.error("schedule read failed", error);
      res.status(500).json({ error: "Could not load schedule." });
    }
  });

  async function save(req, res, kind, action) {
    const { proposalId, itemId } = req.params;
    if (!uuid.test(proposalId) || (itemId && !uuid.test(itemId))) return res.status(404).json({ error: "Schedule item not found." });
    const config = kinds[kind];
    let connection;
    try {
      connection = await req.database.connect();
      await connection.query("begin");
      await connection.query("select id from proposals where id=$1 for update", [proposalId]);
      const { actor, proposal } = await loadSchedulePermissionContext(connection, proposalId, req.userId);
      const fail = async (status, error) => {
        await connection.query("rollback");
        return res.status(status).json({ error });
      };
      if (!canReadSchedule(actor, proposal)) return await fail(403, "You do not have access to this proposal.");
      if (!canChangeSchedule(actor, proposal)) return await fail(["submitted", "archived"].includes(proposal.status) ? 409 : 403, "You cannot change the schedule in this proposal.");
      const current = itemId ? (await connection.query(`select s.*,${dateColumns(kind)} from ${config.table} s where id=$1 and proposal_id=$2 and status='active' for update`, [itemId, proposalId])).rows[0] : null;
      if (itemId && !current) return await fail(404, "Schedule item not found.");
      const canManage = kind === "events" ? canManageScheduleEvent : canManageTimelineItem;
      const id = itemId ?? randomUUID();
      if (current && !canManage(actor, proposal, current)) return await fail(403, "You cannot manage this schedule item.");
      if (action === "remove") {
        await connection.query(`update ${config.table} set status='removed',removed_at=now(),removed_by_user_id=$1,updated_by_user_id=$1,updated_at=now() where id=$2 and proposal_id=$3`, [req.userId, id, proposalId]);
      } else {
        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) return await fail(400, "Enter valid schedule information.");
        const field = (key, column, fallback = null) => Object.hasOwn(body, key) ? body[key] : current?.[column] ?? fallback;
        const next = { id, proposal_id: proposalId, status: "active", title: field("title", "title", "") };
        if (typeof next.title !== "string" || !next.title.trim()) return await fail(400, "Enter a title.");
        next.title = next.title.trim();
        if (kind === "events") {
          Object.assign(next, {
            partner_id: field("partnerId", "partner_id"), organizer_user_id: field("organizerUserId", "organizer_user_id"),
            workstream_id: field("workstreamId", "workstream_id") || null, notes: field("notes", "notes"),
            event_type: field("eventType", "event_type", "meeting"), event_date: field("eventDate", "event_date"),
            all_day: field("allDay", "all_day", true), time_zone: field("timeZone", "time_zone"),
          });
          if (typeof next.all_day !== "boolean" || !["meeting", "deadline", "reminder"].includes(next.event_type) || !validDate(next.event_date)
            || (next.workstream_id !== null && !uuid.test(next.workstream_id))) return await fail(400, "Choose a valid event type, date and workstream.");
          if (!uuid.test(next.partner_id ?? "") || !uuid.test(next.organizer_user_id ?? "")) return await fail(400, "Choose a partner and organizer.");
        } else {
          Object.assign(next, { lead_partner_id: field("leadPartnerId", "lead_partner_id"), description: field("description", "description"), progress: field("progress", "progress", "planned") });
          if (!uuid.test(next.lead_partner_id ?? "") || !progress.includes(next.progress)) return await fail(400, "Choose a valid lead partner and progress.");
          if (kind === "workstreams") {
            next.start_date = field("startDate", "start_date");
            next.end_date = field("endDate", "end_date");
            if (!validDate(next.start_date) || !validDate(next.end_date) || next.end_date < next.start_date) return await fail(400, "Choose an end date on or after the start date.");
          } else {
            next.due_date = field("dueDate", "due_date");
            if (!validDate(next.due_date)) return await fail(400, "Choose a valid due date.");
          }
        }
        const textField = kind === "events" ? "notes" : "description";
        if (next[textField] !== null && typeof next[textField] !== "string") return await fail(400, "Enter valid notes or description.");
        next[textField] = next[textField]?.trim() || null;
        const canUpdate = kind === "events" ? canUpdateScheduleEvent : canUpdateTimelineItem;
        if (current ? !canUpdate(actor, proposal, current, next) : !canManage(actor, proposal, next)) return await fail(403, "You cannot assign this schedule item.");

        if (kind === "events") {
          const assignmentChanged = !current || next.partner_id !== current.partner_id || next.organizer_user_id !== current.organizer_user_id;
          if (assignmentChanged) {
            const member = await connection.query("select 1 from proposal_memberships m join users u on u.id=m.user_id join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.partner_id=$2 and m.user_id=$3 and m.status='active' and cp.status='active' and u.status='active'", [proposalId, next.partner_id, next.organizer_user_id]);
            if (!member.rowCount) return await fail(400, "Choose an active organizer from the responsible partner.");
          }
          if (next.workstream_id && (!current || next.workstream_id !== current.workstream_id)) {
            const workstream = await connection.query("select 1 from schedule_workstreams where id=$1 and proposal_id=$2 and status='active'", [next.workstream_id, proposalId]);
            if (!workstream.rowCount) return await fail(400, "Choose an active workstream in this proposal.");
          }
          if (next.all_day) {
            next.starts_at = null;
            next.ends_at = null;
            next.time_zone = null;
          } else {
            if (typeof next.time_zone !== "string") return await fail(400, "Choose a named time zone.");
            const zone = await connection.query("select 1 from pg_timezone_names where name=$1 and (name='UTC' or name ~ '^[A-Za-z_]+/[A-Za-z_]+(/[A-Za-z_]+)?$')", [next.time_zone]);
            if (!zone.rowCount) return await fail(400, "Choose a named time zone such as Europe/Athens.");
            next.starts_at = await eventInstant(connection, next.event_date, field("startTime", "start_time"), next.time_zone, body.startOccurrence, current?.starts_at);
            const endTime = field("endTime", "end_time");
            next.ends_at = endTime ? await eventInstant(connection, next.event_date, endTime, next.time_zone, body.endOccurrence, current?.ends_at) : null;
            if (next.ends_at && next.ends_at <= next.starts_at) return await fail(400, "End time must be after start time.");
          }
        } else if (!current || next.lead_partner_id !== current.lead_partner_id) {
          const partner = await connection.query("select 1 from consortium_partners where id=$1 and proposal_id=$2 and status='active'", [next.lead_partner_id, proposalId]);
          if (!partner.rowCount) return await fail(400, "Choose an active lead partner.");
        }

        if (!current) {
          const columns = ["id", "proposal_id", ...config.columns, "created_by_user_id", "updated_by_user_id"];
          const values = [id, proposalId, ...config.columns.map(column => next[column]), req.userId, req.userId];
          await connection.query(`insert into ${config.table}(${columns.join(",")}) values(${values.map((_, index) => "$" + (index + 1)).join(",")})`, values);
        } else {
          // only write changed columns so historical assignments are kept
          const changed = config.columns.filter(column => {
            const before = current[column] instanceof Date ? current[column].toISOString() : current[column];
            return before !== next[column];
          });
          const assignments = changed.map((column, index) => column + "=$" + (index + 1));
          const values = changed.map(column => next[column]);
          values.push(req.userId, id, proposalId);
          assignments.push(`updated_by_user_id=$${values.length - 2}`, "updated_at=now()");
          await connection.query(`update ${config.table} set ${assignments.join(",")} where id=$${values.length - 1} and proposal_id=$${values.length}`, values);
        }
      }
      await connection.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id) values($1,$2,$3,$4,$5,$6)", [randomUUID(), proposalId, req.userId, config.entity + "." + ({ create: "created", update: "updated", remove: "removed" }[action]), config.entity, id]);
      await connection.query("commit");
      res.status(action === "create" ? 201 : 200).json({ id });
    } catch (error) {
      if (connection) await connection.query("rollback").catch(() => {});
      if (error.status === 400) return res.status(400).json({ error: error.message });
      if (["23503", "23514", "22007", "22008", "22023"].includes(error.code)) return res.status(400).json({ error: "Check the dates and choose valid proposal partners, members and workstreams." });
      console.error("schedule save failed", error);
      res.status(500).json({ error: "Could not save schedule item." });
    } finally {
      connection?.release();
    }
  }
  for (const kind of Object.keys(kinds)) {
    app.post(base + "/" + kind, (req, res) => save(req, res, kind, "create"));
    app.patch(base + "/" + kind + "/:itemId", (req, res) => save(req, res, kind, "update"));
    app.delete(base + "/" + kind + "/:itemId", (req, res) => save(req, res, kind, "remove"));
  }
}
