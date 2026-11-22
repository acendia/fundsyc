import { useEffect, useRef, useState } from "react";
import { entryTime } from "./schedule-calendar";
import { scheduleProgressOptions } from "./models";
import type { ApiFetch, OverviewData, OverviewItem, OverviewTarget } from "./api-types";

type Props = { proposalId: string; refreshKey: number; apiFetch: ApiFetch; onAccessLost: () => void; onOpen: (target: OverviewTarget) => void };
const roleNames: Record<string, string> = { coordinator_manager: "Coordinator", partner_admin: "Partner administrator", contributor: "Contributor", viewer: "Viewer" };
const proposalStatuses: Record<string, string> = { draft: "Draft", in_preparation: "In preparation", submitted: "Submitted", archived: "Archived" };
const dateTime = (date: string) => new Date(date).toLocaleString();

export function OverviewPage({ proposalId, refreshKey, apiFetch, onAccessLost, onOpen }: Props) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadedKey, setLoadedKey] = useState("");
  const lostRef = useRef(false);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const path = `/api/proposals/${proposalId}/overview?timeZone=${encodeURIComponent(timeZone)}`;
  const requestKey = path + ":" + refreshKey;
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
      setData(result); setLoadedKey(requestKey);
    }).catch(failure => {
      if (!controller.signal.aborted) {
        setData(null); setLoadedKey("");
        setError(failure instanceof Error ? failure.message : "Could not load the proposal overview.");
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, requestKey, apiFetch, onAccessLost]);

  // never show an old proposal snapshot as if it were the latest one
  const current = !loading && loadedKey === requestKey ? data : null;
  const openItem = (item: OverviewItem) => {
    if (item.kind === "milestones" || item.kind === "workstreams") onOpen({ page: "schedule", id: item.id, scheduleKind: item.kind });
    else onOpen({ page: item.kind, id: item.id });
  };
  function items(rows: OverviewItem[], today: string, empty: string) {
    if (!rows.length) return <p>{empty}</p>;
    return <ul className="overview-list">{rows.map((item, index) => <li key={`${item.kind}:${item.id}:${index}`}>
      <button type="button" onClick={() => openItem(item)}>{item.title}</button>
      <p>{item.reason}{item.partner ? ` · ${item.partner}` : ""}{item.owner ? ` · ${item.owner}` : ""}
        {item.due_date && <> · {item.kind === "workstreams" ? "Ends" : "Due"} <span className={item.overdue && item.due_date < today ? "overview-overdue" : undefined}>{item.due_date}</span></>}</p>
    </li>)}</ul>;
  }
  return <main>
    <h1>Overview</h1>
    {error && <p role="alert">{error} Use Refresh to try again.</p>}
    {loading && <p role="status">Loading proposal overview...</p>}
    {current && <>
      <header>
        <h2>{current.proposal.title}</h2>
        <p>{current.proposal.acronym ? current.proposal.acronym + " · " : ""}{proposalStatuses[current.proposal.status] ?? current.proposal.status}</p>
        <p>Coordinator: {current.proposal.coordinator_name} · Your role: {roleNames[current.role] ?? current.role}</p>
        {!current.editable && <p>Tasks, requirements and documents are read-only. Discussions and messaging remain available according to your role.</p>}
      </header>
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
          <section className="section section-records" aria-label="Needs attention">
            <h2>Needs attention</h2>
            {items(current.attention, current.today, "No overdue items or other blockers were found.")}
            {current.attention.length === 6 && <p>Showing up to six items. Open the relevant section to see all.</p>}
          </section>
          <section className="section section-records" aria-label="Your actions">
            <h2>{current.editable ? "Your actions" : "Your items"}</h2>
            <p>Your unfinished tasks and requirements{current.editable ? ", and pending reviews you can respond to" : ""}. Requirement ownership does not grant editing permission.</p>
            {items(current.mine, current.today, "You have no pending items here.")}
            {current.mine.length === 6 && <p>Showing up to six items. Open the relevant section to see all.</p>}
          </section>
          <section className="section section-records" aria-label="Proposal timeline">
            <h2>Proposal timeline</h2>
            <p><button type="button" onClick={() => onOpen({ page: "schedule" })}>View Schedule</button></p>
            {!current.timeline.length ? <p>No current or upcoming incomplete workstreams.</p> : <ul className="overview-list">{current.timeline.map(item => <li key={item.id}>
              <button type="button" onClick={() => onOpen({ page: "schedule", id: item.id, scheduleKind: "workstreams" })}>{item.title}</button>
              <p>{item.partner_name} · {item.start_date}–{item.end_date}</p>
              <p>{scheduleProgressOptions.find(option => option.value === item.progress)?.label ?? item.progress}</p>
            </li>)}</ul>}
          </section>
        </div>
        <div>
          <section className="section section-records" aria-label="Upcoming">
            <h2>Upcoming</h2>
            <p>{current.today} to {current.through} · {current.time_zone}</p>
            {!current.upcoming.length ? <p>No upcoming events, milestones or task deadlines.</p> : <ul className="overview-list">{current.upcoming.map(item => <li key={item.kind + item.id}>
              <button type="button" onClick={() => onOpen(item.kind === "tasks" ? { page: "tasks", id: item.id } : { page: "schedule", id: item.id, scheduleKind: item.kind })}>{item.title}</button>
              <p>{item.date} · {entryTime(item)}{item.startsAt !== null ? ` · ${current.time_zone}` : ""}</p>
              <p>{item.partner}</p>
            </li>)}</ul>}
            <p><button type="button" onClick={() => onOpen({ page: "schedule" })}>View Schedule</button></p>
          </section>
          <section className="section section-records" aria-label="Recent discussions">
            <h2>Recent discussions</h2>
            {!current.discussions.length ? <p>No discussions yet.</p> : <ul className="overview-list">{current.discussions.map(item => <li key={item.id}>
              <button type="button" onClick={() => onOpen({ page: "discussions", id: item.id })}>{item.title}</button>
              <p>{item.reply_count} replies · Latest activity {dateTime(item.last_activity_at)}</p>
            </li>)}</ul>}
            <p><button type="button" onClick={() => onOpen({ page: "discussions" })}>View Discussions</button></p>
          </section>
          {current.messaging_available && <section className="section section-records" aria-label="Your recent chats">
            <h2>Your recent chats</h2>
            <p>Only chats you participate in are shown. No unread tracking.</p>
            {!current.conversations.length ? <p>You have no chats yet.</p> : <ul className="overview-list">{current.conversations.map(item => <li key={item.id}>
              <button type="button" onClick={() => onOpen({ page: "messages", id: item.id })}>{item.kind === "direct" ? "Chat with " : ""}{item.title ?? "Participant"}</button>
              <p>{item.kind === "direct" ? "Direct" : "Group"} · Latest activity {dateTime(item.last_activity_at)}</p>
            </li>)}</ul>}
            <p><button type="button" onClick={() => onOpen({ page: "messages" })}>View Messages</button></p>
          </section>}
        </div>
      </div>
      <p>Updated {dateTime(current.generated_at)}. Use Refresh to load the latest information.</p>
    </>}
  </main>;
}
