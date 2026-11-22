import { loadRequirementPermissionContext, canReadRequirements, canManageRequirements } from "./requirement-permissions.mjs";
import { loadRequirements } from "./requirements.mjs";
import { summarize } from "./requirement-progress.mjs";
import { canChangeDocuments, canAddDocument } from "./document-permissions.mjs";
import { canReadMessaging } from "./messaging-permissions.mjs";
import { loadConversationSummaries } from "./messaging.mjs";
import { dateInZone, addCalendarDays, calendarEntries, upcomingEntries } from "../shared/schedule-calendar.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const priorityOrder = "case t.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end";
const requirementReasons = { overdue: "Overdue requirement", linked_task_removed: "Linked task removed", responsible_inactive: "Owner or institution no longer active" };
const shortRequirement = (item, reason) => ({ kind: "requirements", id: item.id, title: `${item.code} · ${item.title}`, partner: item.partner_name, owner: item.owner_name, due_date: item.due_date, reason });
const shortTask = (task, reason) => ({ kind: "tasks", id: task.id, title: task.title, partner: task.partner_name, owner: null, due_date: task.due_date, reason });
// overdue first, then dated items, with stable tie breakers
function attentionOrder(a, b) {
  return Number(b.overdue) - Number(a.overdue)
    || (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31")
    || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

export function addOverviewRoutes(app) {
  app.get("/api/proposals/:proposalId/overview", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const proposalId = req.params.proposalId.toLowerCase();
    if (!uuid.test(proposalId)) return res.status(404).json({ error: "Proposal not found." });
    const timeZone = req.query.timeZone ?? "UTC";
    if (typeof timeZone !== "string" || timeZone.length > 100) return res.status(400).json({ error: "Choose a valid display time zone." });
    const now = new Date();
    let today;
    try { today = dateInZone(now, timeZone); }
    catch { return res.status(400).json({ error: "Choose a valid display time zone." }); }
    const lastDay = addCalendarDays(today, 13);
    let c;
    try {
      c = await req.database.connect();
      // every count and preview uses the same read-only snapshot
      await c.query("begin isolation level repeatable read read only");
      const { actor, proposal } = await loadRequirementPermissionContext(c, proposalId, req.userId);
      if (!canReadRequirements(actor, proposal)) {
        await c.query("rollback");
        return res.status(403).json({ error: "You do not have access to this proposal." });
      }
      // batch the independent previews without changing their filters or ordering
      const [{ header, tasks, documents, consortium, overdueTasks, reviews, overdueMilestones,
        risks, myTasks, myReviews, events, milestones, taskDeadlines, timeline, discussions }] = (await c.query(`select
        (select row_to_json(s) from (select p.id,p.title,p.acronym,p.status,o.legal_name as coordinator_name
        from proposals p join consortium_partners cp on cp.id=p.coordinator_partner_id and cp.proposal_id=p.id
        join organizations o on o.id=cp.organization_id where p.id=$1) s) as header,
        (select row_to_json(s) from (select count(*)::int as total,
        count(*) filter(where progress='completed')::int as completed,
        count(*) filter(where progress='in_progress')::int as in_progress,
        count(*) filter(where progress='in_review')::int as in_review,
        count(*) filter(where progress='todo')::int as todo
        from tasks where proposal_id=$1 and status='active') s) as tasks,
        (select row_to_json(s) from (select
        (select count(*)::int from documents where proposal_id=$1 and status='active') as total,
        (select count(distinct v.id)::int from document_versions v join documents d on d.id=v.document_id and d.proposal_id=v.proposal_id
          join document_reviews r on r.version_id=v.id and r.proposal_id=v.proposal_id
          where d.proposal_id=$1 and d.status='active' and r.status='pending') as pending_versions) s) as documents,
        (select row_to_json(s) from (select
        (select count(*)::int from consortium_partners where proposal_id=$1 and status='active') as partners,
        (select count(*)::int from proposal_memberships m join users u on u.id=m.user_id
          join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id
          where m.proposal_id=$1 and m.status='active' and cp.status='active' and u.status='active') as members) s) as consortium,

        array(select row_to_json(s) from (select t.id,t.title,t.due_date::text as due_date,o.legal_name as partner_name
        from tasks t join consortium_partners cp on cp.id=t.partner_id and cp.proposal_id=t.proposal_id join organizations o on o.id=cp.organization_id
        where t.proposal_id=$1 and t.status='active' and t.progress<>'completed' and t.due_date<$2::date
        order by t.due_date,${priorityOrder},t.title,t.id limit 6) s) as "overdueTasks",
        array(select row_to_json(s) from (select r.id,r.reviewer_user_id,r.due_date::text as due_date,d.id as document_id,d.title,v.version_number,u.display_name as reviewer_name
        from document_reviews r join document_versions v on v.id=r.version_id and v.proposal_id=r.proposal_id
        join documents d on d.id=v.document_id and d.proposal_id=v.proposal_id join users u on u.id=r.reviewer_user_id
        where r.proposal_id=$1 and d.status='active' and r.status='pending' and r.due_date<$2::date
        order by r.due_date,d.title,r.id limit 6) s) as reviews,
        array(select row_to_json(s) from (select s.id,s.title,s.due_date::text as due_date,o.legal_name as partner_name
        from schedule_milestones s join consortium_partners cp on cp.id=s.lead_partner_id and cp.proposal_id=s.proposal_id join organizations o on o.id=cp.organization_id
        where s.proposal_id=$1 and s.status='active' and s.progress<>'completed' and s.due_date<$2::date
        order by s.due_date,s.title,s.id limit 6) s) as "overdueMilestones",
        array(select row_to_json(s) from (select s.id,s.title,s.end_date::text as due_date,o.legal_name as partner_name
        from schedule_workstreams s join consortium_partners cp on cp.id=s.lead_partner_id and cp.proposal_id=s.proposal_id join organizations o on o.id=cp.organization_id
        where s.proposal_id=$1 and s.status='active' and s.progress='at_risk' order by s.end_date,s.title,s.id limit 6) s) as risks,

        array(select row_to_json(s) from (select t.id,t.title,t.due_date::text as due_date,o.legal_name as partner_name
        from tasks t join consortium_partners cp on cp.id=t.partner_id and cp.proposal_id=t.proposal_id join organizations o on o.id=cp.organization_id
        where t.proposal_id=$1 and t.status='active' and t.progress<>'completed'
          and exists(select 1 from task_assignees a where a.task_id=t.id and a.proposal_id=t.proposal_id and a.user_id=$6 and a.status='active')
        order by t.due_date nulls last,${priorityOrder},t.title,t.id limit 6) s) as "myTasks",
        array(select row_to_json(s) from (select d.id,d.title,v.version_number,r.due_date::text as due_date
        from document_reviews r join document_versions v on v.id=r.version_id and v.proposal_id=r.proposal_id
        join documents d on d.id=v.document_id and d.proposal_id=v.proposal_id
        where $7::boolean and r.proposal_id=$1 and r.reviewer_user_id=$6 and r.status='pending' and d.status='active'
        order by r.due_date nulls last,d.title,r.id limit 6) s) as "myReviews",

        array(select row_to_json(s) from (select s.id,s.title,s.event_date::text as event_date,s.all_day,s.starts_at,s.ends_at,o.legal_name as partner_name
        from schedule_events s join consortium_partners cp on cp.id=s.partner_id and cp.proposal_id=s.proposal_id join organizations o on o.id=cp.organization_id
        where s.proposal_id=$1 and s.status='active' and (
          (s.all_day and s.event_date between $2::date and $3::date)
          or (not s.all_day and s.starts_at<(($3::date+1)::timestamp at time zone $4) and (s.starts_at>=$5::timestamptz or s.ends_at>$5::timestamptz)))) s) as events,
        array(select row_to_json(s) from (select s.id,s.title,s.due_date::text as due_date,s.progress,o.legal_name as partner_name
        from schedule_milestones s join consortium_partners cp on cp.id=s.lead_partner_id and cp.proposal_id=s.proposal_id join organizations o on o.id=cp.organization_id
        where s.proposal_id=$1 and s.status='active' and s.progress<>'completed' and s.due_date between $2::date and $3::date) s) as milestones,
        array(select row_to_json(s) from (select t.id,t.title,t.due_date::text as due_date,t.progress,o.legal_name as partner_name
        from tasks t join consortium_partners cp on cp.id=t.partner_id and cp.proposal_id=t.proposal_id join organizations o on o.id=cp.organization_id
        where t.proposal_id=$1 and t.status='active' and t.progress<>'completed' and t.due_date between $2::date and $3::date) s) as "taskDeadlines",
        array(select row_to_json(s) from (select s.id,s.title,s.start_date::text as start_date,s.end_date::text as end_date,s.progress,o.legal_name as partner_name
        from schedule_workstreams s join consortium_partners cp on cp.id=s.lead_partner_id and cp.proposal_id=s.proposal_id join organizations o on o.id=cp.organization_id
        where s.proposal_id=$1 and s.status='active' and s.progress<>'completed' and s.end_date>=$2::date
        order by case when s.start_date<=$2::date then 0 else 1 end,s.start_date,s.id limit 4) s) as timeline,
        array(select row_to_json(s) from (select d.id,d.title,greatest(d.updated_at,coalesce(r.latest,d.updated_at)) as last_activity_at,coalesce(r.replies,0)::int as reply_count
        from discussions d left join lateral (select max(updated_at) as latest,count(*) as replies from discussion_replies where discussion_id=d.id and proposal_id=d.proposal_id and status='active') r on true
        where d.proposal_id=$1 and d.status='active' order by last_activity_at desc,d.id desc limit 3) s) as discussions`,
        [proposalId, today, lastDay, timeZone, now, req.userId, canChangeDocuments(proposal) && canAddDocument(actor)])).rows;
      const requirements = await loadRequirements(c, proposalId, today);
      const requirementSummary = summarize(requirements);
      const attention = [
        ...overdueTasks.map(task => shortTask(task, "Overdue task")),
        ...requirements.filter(item => item.attention.length).map(item => shortRequirement(item, item.attention.map(reason => requirementReasons[reason]).join("; "))),
        ...reviews.map(review => ({ kind: "documents", id: review.document_id, title: `${review.title} · Version ${review.version_number}`, partner: null, owner: review.reviewer_name, due_date: review.due_date, reason: "Overdue document review" })),
        ...overdueMilestones.map(item => ({ kind: "milestones", id: item.id, title: item.title, partner: item.partner_name, owner: null, due_date: item.due_date, reason: "Overdue milestone" })),
        ...risks.map(item => ({ kind: "workstreams", id: item.id, title: item.title, partner: item.partner_name, owner: null, due_date: item.due_date, reason: "Workstream at risk" })),
      ].map(item => ({ ...item, overdue: Boolean(item.due_date && item.due_date < today && item.kind !== "workstreams"
        && (item.kind !== "requirements" || item.reason.includes(requirementReasons.overdue))) })).sort(attentionOrder).slice(0, 6);

      const mine = [
        ...myTasks.map(task => shortTask(task, "Assigned to you")),
        ...myReviews.map(review => ({ kind: "documents", id: review.id, title: `${review.title} · Version ${review.version_number}`, partner: null, owner: null, due_date: review.due_date, reason: "Awaiting your review" })),
        ...requirements.filter(item => !item.completed && item.owner_user_id === req.userId).map(item => shortRequirement(item, "Owned by you")),
        ...(canManageRequirements(actor, proposal) ? requirements.filter(item => !item.completed && !item.owner_user_id).map(item => shortRequirement(item, "No owner assigned")) : []),
      ].map(item => ({ ...item, overdue: Boolean(item.due_date && item.due_date < today) })).sort(attentionOrder).slice(0, 6);

      const upcoming = upcomingEntries(calendarEntries(events, milestones, timeZone, taskDeadlines), now, timeZone);
      // never read or count conversations the caller cannot access, including for the coordinator
      const messagingAvailable = canReadMessaging(actor, proposal);
      const conversations = messagingAvailable ? await loadConversationSummaries(c, proposalId, req.userId, 3) : [];
      await c.query("commit");
      res.json({
        proposal: header, role: actor.access_role, today, through: lastDay, time_zone: timeZone, generated_at: now.toISOString(),
        summary: { tasks, requirements: requirementSummary, documents, consortium, upcoming: upcoming.length },
        attention, mine, upcoming: upcoming.slice(0, 5), timeline,
        discussions: discussions.map(item => ({ ...item, last_activity_at: new Date(item.last_activity_at).toISOString() })),
        messaging_available: messagingAvailable,
        conversations: conversations.map(({ id, kind, title, last_activity_at }) => ({ id, kind, title, last_activity_at })),
        editable: ["draft", "in_preparation"].includes(proposal.status),
      });
    } catch (error) {
      if (c) await c.query("rollback").catch(() => {});
      console.error("overview read failed", error);
      res.status(500).json({ error: "Could not load the proposal overview. Please refresh and try again." });
    } finally { c?.release(); }
  });
}
