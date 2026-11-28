import { useEffect, useRef, useState } from "react";
import { entryTime } from "../schedule/schedule-calendar";
import { scheduleProgressOptions } from "../models";
import type { ApiFetch, OverviewData, OverviewItem, OverviewTarget } from "../api-types";

type Props = { proposalId: string; refreshKey: number; apiFetch: ApiFetch; onAccessLost: () => void; onOpen: (target: OverviewTarget) => void };
const roleNames: Record<string, string> = { coordinator_manager: "Coordinator", partner_admin: "Partner administrator", contributor: "Contributor", viewer: "Viewer" };
const proposalStatuses: Record<string, string> = { draft: "Draft", in_preparation: "In preparation", submitted: "Submitted", archived: "Archived" };
const dateTime = (date: string) => new Date(date).toLocaleString();
const calendarDate = (date: string) => new Intl.DateTimeFormat(undefined, {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
}).format(new Date(date + "T00:00:00Z"));

export function OverviewPage({ proposalId, refreshKey, apiFetch, onAccessLost, onOpen }: Props) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadedPath, setLoadedPath] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const lostRef = useRef(false);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const path = `/api/proposals/${proposalId}/overview?timeZone=${encodeURIComponent(timeZone)}`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    apiFetch(path, { signal: controller.signal }).then(async response => {
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The Overview API is unavailable. Restart the local app and try again.");
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 403 && !lostRef.current) { lostRef.current = true; onAccessLost(); }
        throw new Error(result.error || "Could not load the proposal overview.");
      }
      lostRef.current = false;
      setData(result); setLoadedPath(path);
    }).catch(failure => {
      if (!controller.signal.aborted) {
        setData(null); setLoadedPath("");
        setError(failure instanceof Error ? failure.message : "Could not load the proposal overview.");
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, refreshKey, refreshCount, apiFetch, onAccessLost]);

  // keep the current proposal visible during refresh, never show another proposal's data
  const current = loadedPath === path ? data : null;
  const openItem = (item: OverviewItem) => {
    if (item.kind === "milestones" || item.kind === "workstreams") onOpen({ page: "schedule", id: item.id, scheduleKind: item.kind });
    else onOpen({ page: item.kind, id: item.id });
  };
  function items(rows: OverviewItem[], today: string, empty: string) {
    if (!rows.length) return <p>{empty}</p>;
    return <ul className="overview-list">{rows.map((item, index) => <li key={`${item.kind}:${item.id}:${index}`}>
      <button type="button" onClick={() => openItem(item)}>{item.title}</button>
      <p>{item.reason}{item.partner ? ` · ${item.partner}` : ""}{item.owner ? ` · ${item.owner}` : ""}
        {item.due_date && <> · {item.kind === "workstreams" ? "Ends" : "Due"} <time dateTime={item.due_date} className={item.overdue && item.due_date < today ? "overview-overdue" : undefined}>{calendarDate(item.due_date)}</time></>}</p>
    </li>)}</ul>;
  }
  const viewSection = (page: OverviewTarget["page"], label: string) => <button type="button" className="overview-link" aria-label={label === "View" ? `View ${page}` : undefined} onClick={() => onOpen({ page })}>{label} <span aria-hidden="true">→</span></button>;
  return <main className="proposal-overview">
    <header className="overview-heading">
      <div className="overview-heading-row">
        <div>
          {current && <p className="overview-eyebrow">Proposal{current.proposal.acronym ? ` / ${current.proposal.acronym}` : ""}</p>}
          <h1>{current?.proposal.title ?? "Overview"}</h1>
          {current && <p>Proposal overview · {proposalStatuses[current.proposal.status] ?? current.proposal.status}</p>}
        </div>
        <button type="button" className="overview-refresh" disabled={loading} onClick={() => { setLoading(true); setRefreshCount(count => count + 1); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 4v6h-6M20 10a8 8 0 1 0 .6 4" />
          </svg>
          {loading && current ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {current && !current.editable && <p>Tasks, requirements and documents are read-only. Discussions and messaging remain available according to your role.</p>}
    </header>
    {error && <p role="alert">{error} Use Refresh to try again.</p>}
    {loading && !current && <p role="status">Loading proposal overview...</p>}
    {current && <>
      <section className="overview-summary" aria-label="Proposal summary">
        <div><h3><button type="button" onClick={() => onOpen({ page: "tasks" })}>Tasks</button></h3>
          <p><strong>{current.summary.tasks.total}</strong> total · {current.summary.tasks.completed} completed</p>
          <p>{current.summary.tasks.todo} to do · {current.summary.tasks.in_progress} in progress · {current.summary.tasks.in_review} in review</p></div>
        <div><h3><button type="button" onClick={() => onOpen({ page: "requirements" })}>Requirements</button></h3>
          <p><strong>{current.summary.requirements.completed}/{current.summary.requirements.total}</strong> completed</p>
          <p>{current.summary.requirements.needs_attention} need attention</p></div>
        <div><h3><button type="button" onClick={() => onOpen({ page: "documents" })}>Documents</button></h3>
          <p><strong>{current.summary.documents.total}</strong> active documents</p>
          <p>{current.summary.documents.pending_versions} versions awaiting review</p></div>
        <div><h3><button type="button" onClick={() => onOpen({ page: "consortium" })}>Consortium</button></h3>
          <p><strong>{current.summary.consortium.partners}</strong> active partners</p>
          <p>{current.summary.consortium.members} active members</p></div>
        <div><h3><button type="button" onClick={() => onOpen({ page: "schedule" })}>Schedule</button></h3>
          <p><strong>{current.summary.upcoming}</strong> upcoming items</p><p>Next 14 days</p></div>
      </section>
      <div className="overview-columns">
        <div>
          <section className="overview-panel" aria-label="Needs attention">
            <div className="overview-panel-heading"><h2>Needs attention</h2>{viewSection("tasks", "All tasks")}</div>
            {items(current.attention, current.today, "No overdue items or other blockers were found.")}
            {current.attention.length === 6 && <p>Showing up to six items. Open the relevant section to see all.</p>}
          </section>
          <section className="overview-panel" aria-label="Proposal timeline">
            <div className="overview-panel-heading"><h2>Proposal timeline</h2>{viewSection("schedule", "Schedule")}</div>
            {!current.timeline.length ? <p>No current or upcoming incomplete workstreams.</p> : <ul className="overview-list">{current.timeline.map(item => <li key={item.id}>
              <button type="button" onClick={() => onOpen({ page: "schedule", id: item.id, scheduleKind: "workstreams" })}>{item.title}</button>
              <p>{item.partner_name} · {calendarDate(item.start_date)} – {calendarDate(item.end_date)}</p>
              <span className="overview-row-note">{scheduleProgressOptions.find(option => option.value === item.progress)?.label ?? item.progress}</span>
            </li>)}</ul>}
          </section>
          <section className="overview-panel" aria-label={current.editable ? "Your actions" : "Your items"}>
            <div className="overview-panel-heading"><h2>{current.editable ? "Your actions" : "Your items"}</h2></div>
            {items(current.mine, current.today, "You have no pending items here.")}
            {current.mine.length === 6 && <p>Showing up to six items. Open the relevant section to see all.</p>}
          </section>
        </div>
        <div>
          <section className="overview-panel" aria-label="Upcoming">
            <div className="overview-panel-heading"><h2>Upcoming</h2>{viewSection("schedule", "Calendar")}</div>
            <p>{calendarDate(current.today)} – {calendarDate(current.through)} · {current.time_zone}</p>
            {!current.upcoming.length ? <p>No upcoming events, milestones or task deadlines.</p> : <ul className="overview-list">{current.upcoming.map(item => <li key={item.kind + item.id}>
              <button type="button" onClick={() => onOpen(item.kind === "tasks" ? { page: "tasks", id: item.id } : { page: "schedule", id: item.id, scheduleKind: item.kind })}>{item.title}</button>
              <p>{item.partner} · {entryTime(item)}</p>
              <time className="overview-row-note" dateTime={item.date}>{calendarDate(item.date)}</time>
            </li>)}</ul>}
          </section>
          <section className="overview-panel" aria-label="Consortium">
            <div className="overview-panel-heading"><h2>Consortium</h2>{viewSection("consortium", "View")}</div>
            <dl className="overview-facts">
              <div><dt>Coordinator</dt><dd>{current.proposal.coordinator_name}</dd></div>
              <div><dt>Partners</dt><dd>{current.summary.consortium.partners} active</dd></div>
              <div><dt>Members</dt><dd>{current.summary.consortium.members} active</dd></div>
              <div><dt>Your role</dt><dd>{roleNames[current.role] ?? current.role}</dd></div>
            </dl>
          </section>
          <section className="overview-panel" aria-label="Recent discussions">
            <div className="overview-panel-heading"><h2>Recent discussions</h2>{viewSection("discussions", "View")}</div>
            {!current.discussions.length ? <p>No discussions yet.</p> : <ul className="overview-list">{current.discussions.map(item => <li key={item.id}>
              <button type="button" onClick={() => onOpen({ page: "discussions", id: item.id })}>{item.title}</button>
              <p>{item.reply_count} replies · Latest activity {dateTime(item.last_activity_at)}</p>
            </li>)}</ul>}
          </section>
          {current.messaging_available && <section className="overview-panel" aria-label="Your recent chats">
            <div className="overview-panel-heading"><h2>Your recent chats</h2>{viewSection("messages", "View")}</div>
            {!current.conversations.length ? <p>You have no chats yet.</p> : <ul className="overview-list">{current.conversations.map(item => <li key={item.id}>
              <button type="button" onClick={() => onOpen({ page: "messages", id: item.id })}>{item.kind === "direct" ? "Chat with " : ""}{item.title ?? "Participant"}</button>
              <p>{item.kind === "direct" ? "Direct" : "Group"} · Latest activity {dateTime(item.last_activity_at)}</p>
            </li>)}</ul>}
          </section>}
        </div>
      </div>
      <p className="overview-updated" aria-live="polite">{loading ? "Refreshing proposal overview…" : `Updated ${dateTime(current.generated_at)}.`}</p>
    </>}
  </main>;
}
