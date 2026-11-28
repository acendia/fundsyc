import { useEffect, useState, type FormEvent } from "react";
import { emptyScheduleFilters, matchesScheduleFilters } from "./schedule-filters";
import { ScheduleTimeline } from "./ScheduleTimeline";
import { ScheduleCalendar } from "./ScheduleCalendar";
import { calendarEntries, entryTime, dateInZone, dayLabel } from "./schedule-calendar";
import { buildScheduleIcs } from "./schedule-ics";
import { scheduleEventTypeOptions, scheduleProgressOptions, taskProgressOptions } from "../models";
import type { ApiFetch } from "../api-types";
import "./SchedulePage.css";

type Kind = "events" | "workstreams" | "milestones";
type Item = {
  id: string;
  title: string;
  partner_name: string;
  partner_id?: string;
  lead_partner_id?: string;
  organizer_user_id?: string;
  organizer_name?: string;
  workstream_id?: string | null;
  notes?: string | null;
  description?: string | null;
  event_type?: string;
  event_date?: string;
  all_day?: boolean;
  start_time?: string | null;
  end_time?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  time_zone?: string | null;
  start_date?: string;
  end_date?: string;
  due_date?: string;
  progress?: string;
  status?: string;
  created_by_name: string;
  updated_by_name: string;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_remove: boolean;
};
type Member = { user_id: string; display_name: string; can_organize: boolean };
type Partner = { id: string; legal_name: string; can_add_timeline: boolean; members: Member[] };
type LinkedTask = { partner_id: string; id: string; title: string; partner_name: string; assignee_name: string | null; progress: string; status: string; due_date: string | null; workstream_id: string | null };
type ScheduleData = {
  tasks: LinkedTask[];
  proposal: { id: string; status: string };
  current_user_id: string;
  partners: Partner[];
  events: Item[];
  workstreams: Item[];
  milestones: Item[];
};
type Props = {
  initialItem?: { kind: Kind; id: string };
  onOpenTask: (id: string) => void;
  proposalId: string;
  refreshKey: number;
  apiFetch: ApiFetch;
  onBusyChange: (busy: boolean) => void;
  onAccessLost: () => void;
};
const names: Record<Kind, string> = { events: "event", workstreams: "workstream", milestones: "milestone" };
const label = (options: readonly { value: string; label: string }[], value?: string) => options.find(option => option.value === value)?.label ?? value;
const kindLabels: Record<Kind, string> = { events: "Event", workstreams: "Workstream", milestones: "Milestone" };
const dates = (kind: Kind, item: Item, timeZone: string) => {
  if (kind === "workstreams") return dayLabel(item.start_date!) + " – " + dayLabel(item.end_date!);
  if (kind === "milestones") return dayLabel(item.due_date!);
  if (item.all_day) return dayLabel(item.event_date!) + " · All day";
  const entry = calendarEntries([item], [], timeZone)[0];
  return dayLabel(entry.date) + " · " + entryTime(entry) + " · " + timeZone;
};
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const dateTime = (value: string) => dateTimeFormat.format(new Date(value));
const zones = ["UTC", ...Intl.supportedValuesOf("timeZone")];
const zoneChoices = (current: string) => [...new Set([current, ...zones])].sort();

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 21l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></svg>;
}

function ProgressBadge({ value }: { value?: string }) {
  return <span className="schedule-badge" data-progress={value}>{label(scheduleProgressOptions, value)}</span>;
}

export function SchedulePage({ initialItem, onOpenTask, proposalId, refreshKey, apiFetch, onBusyChange, onAccessLost }: Props) {
  const [filters, setFilters] = useState({ ...emptyScheduleFilters });
  const [showFilters, setShowFilters] = useState(false);
  const [displayZone, setDisplayZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [data, setData] = useState<ScheduleData | null>(null);
  const [selected, setSelected] = useState<{ kind: Kind; id: string } | null>(initialItem ?? null);
  const [creating, setCreating] = useState<Kind | null>(null);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedKey, setLoadedKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const path = "/api/proposals/" + proposalId + "/schedule";
  const requestKey = path + ":" + refreshKey + ":" + revision;
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadedKey("");
    setError("");
    apiFetch(path, { signal: controller.signal }).then(async response => {
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The Schedule API is unavailable. Restart the local app and try again.");
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setData(null);
        if (response.status === 403) onAccessLost();
        throw new Error(result.error || "Could not load schedule.");
      }
      setData(result);
      setLoadedKey(requestKey);
      setError("");
    }).catch(error => {
      if (!controller.signal.aborted) {
        setError(error instanceof Error ? error.message : "Could not load schedule.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [path, requestKey, apiFetch, onAccessLost]);

  function back() {
    setSelected(null);
    setCreating(null);
    setEditing(false);
  }
  async function save(kind: Kind, method: string, values?: object, id?: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch(path + "/" + kind + (id ? "/" + id : ""), {
        method,
        headers: { "Content-Type": "application/json" },
        body: values ? JSON.stringify(values) : undefined,
      });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The Schedule API is unavailable. Restart the local app and try again.");
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 403) onAccessLost();
        if ([403, 404, 409].includes(response.status)) setRevision(value => value + 1);
        throw new Error(result.error || "Could not save schedule item.");
      }
      setCreating(null);
      setEditing(false);
      setSelected(method === "DELETE" ? null : { kind, id: result.id });
      setMessage(method === "DELETE" ? "Schedule item marked as removed." : "Schedule item saved.");
      setRevision(value => value + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save schedule item.");
    } finally {
      setBusy(false);
    }
  }
  const filtered = {
    events: data?.events.filter(item => matchesScheduleFilters(item, "events", filters)) ?? [],
    workstreams: data?.workstreams.filter(item => matchesScheduleFilters(item, "workstreams", filters)) ?? [],
    milestones: data?.milestones.filter(item => matchesScheduleFilters(item, "milestones", filters)) ?? [],
    tasks: data?.tasks.filter(item => matchesScheduleFilters(item, "tasks", filters)) ?? [],
  };
  const exportCount = filtered.events.length + filtered.workstreams.length + filtered.milestones.length + filtered.tasks.length;
  const canExport = Boolean(data) && !busy && !loading && !error && loadedKey === requestKey && exportCount > 0;
  function exportIcs() {
    if (!canExport) return;
    const ics = buildScheduleIcs(filtered);
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = "fundsyc-schedule.ics";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Schedule exported (.ics).");
  }
  const partners = new Map(data?.partners.map(partner => [partner.id, partner.legal_name]));
  const organizers = new Map(data?.partners.flatMap(partner => partner.members.map(member => [member.user_id, member.display_name] as const)));
  for (const item of [...(data?.events ?? []), ...(data?.workstreams ?? []), ...(data?.milestones ?? []), ...(data?.tasks ?? [])]) {
    const id = "lead_partner_id" in item ? item.lead_partner_id : item.partner_id;
    if (id) partners.set(id, item.partner_name);
  }
  for (const event of data?.events ?? []) {
    if (event.organizer_user_id) organizers.set(event.organizer_user_id, event.organizer_name ?? "Previous organizer");
  }
  const item = selected ? data?.[selected.kind].find(item => item.id === selected.id) : undefined;
  const formKind = creating ?? (editing && item?.can_edit ? selected?.kind : null);
  const readOnly = data ? ["submitted", "archived"].includes(data.proposal.status) : false;
  const canAdd = (kind: Kind) => Boolean(data?.partners.some(partner => kind === "events" ? partner.members.some(member => member.can_organize) : partner.can_add_timeline));
  const filterCount = [filters.type, filters.partner, filters.organizer, filters.progress].filter(Boolean).length;
  const openItem = (kind: Kind, id: string) => { setSelected({ kind, id }); setMessage(""); };
  const startCreate = (kind: Kind) => { setCreating(kind); setSelected(null); setEditing(false); setMessage(""); };
  const summary: { kind: Kind | "tasks"; label: string; count: number }[] = [
    { kind: "events", label: "Events", count: filtered.events.length },
    { kind: "workstreams", label: "Workstreams", count: filtered.workstreams.length },
    { kind: "milestones", label: "Milestones", count: filtered.milestones.length },
    { kind: "tasks", label: "Task deadlines", count: filtered.tasks.length },
  ];
  const heading = creating ? "Add " + names[creating] : item ? item.title : "Schedule";
  return <main className="proposal-overview schedule-page">
    <header className="overview-heading overview-heading-row schedule-heading">
      <div>
        {(selected || creating) && <button type="button" className="overview-link" disabled={busy} onClick={back}>← Back to schedule</button>}
        <h1>{heading}</h1>
        <p>{creating ? "Add it to the shared proposal schedule." : item && selected ? <>{kindLabels[selected.kind]} · {item.partner_name}</> : "Events, workstreams, milestones and task deadlines in one place."}</p>
      </div>
      {data && !selected && !creating && <div className="schedule-actions">
        <button type="button" className="schedule-button" disabled={!canExport} onClick={exportIcs} title="Download the matching items as a calendar file">Export ICS</button>
        {canAdd("events") && <button type="button" className="schedule-primary" disabled={busy} onClick={() => startCreate("events")}><span aria-hidden="true">+</span> Add event</button>}
      </div>}
      {data && item && selected && !editing && (item.can_edit || item.can_remove) && <div className="schedule-actions">
        {item.can_edit && <button type="button" className="schedule-button" disabled={busy} onClick={() => { setEditing(true); setMessage(""); }}>Edit {names[selected.kind]}</button>}
        {item.can_remove && <button type="button" className="schedule-button schedule-danger" disabled={busy} onClick={() => {
          if (window.confirm("Mark " + item.title + " as removed? Its record will be kept.")) void save(selected.kind, "DELETE", undefined, item.id);
        }}>Remove {names[selected.kind]}</button>}
      </div>}
    </header>
    {message && <p className="schedule-feedback" role="status">{message}</p>}
    {error && <p className="schedule-feedback" role="alert">{error}</p>}
    {error && data && <p className="schedule-feedback">The displayed schedule may be out of date. Export is unavailable until it refreshes successfully.</p>}
    {!data && !error && <p role="status">Loading schedule…</p>}
    {data && !error && (loading || loadedKey !== requestKey) && <p className="schedule-muted" role="status">Refreshing schedule…</p>}
    {data && <>
      {readOnly && <p className="schedule-feedback">This proposal is {data.proposal.status} and read-only.</p>}
      <div hidden={Boolean(creating || selected)}>
        <div className="schedule-summary" role="group" aria-label="Show one item type">
          {summary.map(card => <button key={card.kind} type="button" className="schedule-summary-card" data-kind={card.kind} aria-pressed={filters.type === card.kind}
            onClick={() => setFilters({ ...filters, type: filters.type === card.kind ? "" : card.kind })}>
            <strong>{card.count}</strong><span>{card.label}</span>
          </button>)}
        </div>
        <section className="schedule-panel schedule-toolbar" aria-label="Schedule filters">
          <div className="schedule-toolbar-row">
            <div className="schedule-search"><SearchIcon /><input type="search" aria-label="Search schedule titles" placeholder="Search schedule" value={filters.title} onChange={event => setFilters({ ...filters, title: event.target.value })} /></div>
            <button type="button" className="schedule-button" aria-expanded={showFilters} aria-controls="schedule-filters" onClick={() => setShowFilters(!showFilters)}>Filter{filterCount > 0 && <span className="schedule-count">{filterCount}</span>}</button>
            <label className="schedule-zone">Time zone <select value={displayZone} onChange={event => setDisplayZone(event.target.value)}>
              {zoneChoices(displayZone).map(zone => <option value={zone} key={zone}>{zone}</option>)}
            </select></label>
          </div>
          <div id="schedule-filters" className="schedule-filters" role="group" aria-label="Schedule filters" hidden={!showFilters}>
            <label>Item type <select value={filters.type} onChange={event => setFilters({ ...filters, type: event.target.value })}>
              <option value="">All item types</option><option value="events">All events</option>
              {scheduleEventTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              <option value="workstreams">Workstreams</option><option value="milestones">Milestones</option><option value="tasks">Task deadlines</option>
            </select></label>
            <label>Partner <select value={filters.partner} onChange={event => setFilters({ ...filters, partner: event.target.value })}>
              <option value="">All partners</option>{Array.from(partners).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <label>Organizer (events) <select value={filters.organizer} onChange={event => setFilters({ ...filters, organizer: event.target.value })}>
              <option value="">All organizers</option>{Array.from(organizers).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <label>Progress <select value={filters.progress} onChange={event => setFilters({ ...filters, progress: event.target.value })}>
              <option value="">All progress</option>
              <optgroup label="Workstreams and milestones">{scheduleProgressOptions.map(option => <option key={option.value} value={"timeline:" + option.value}>{option.label}</option>)}</optgroup>
              <optgroup label="Tasks">{taskProgressOptions.map(option => <option key={option.value} value={"task:" + option.value}>{option.label}</option>)}</optgroup>
            </select></label>
            <button type="button" className="overview-link" onClick={() => setFilters({ ...emptyScheduleFilters })}>Clear filters</button>
          </div>
          <p className="schedule-muted" role="status">Matching across all dates: {filtered.events.length} events, {filtered.workstreams.length} workstreams, {filtered.milestones.length} milestones, {filtered.tasks.length} task deadlines.</p>
        </section>
        <ScheduleCalendar events={filtered.events} milestones={filtered.milestones} tasks={filtered.tasks} timeZone={displayZone}
          onOpen={(kind, id) => { if (kind === "tasks") onOpenTask(id); else openItem(kind, id); }} />
        <ScheduleTimeline workstreams={filtered.workstreams} milestones={filtered.milestones} today={dateInZone(new Date(), displayZone)}
          onOpen={openItem} />
        {(["events", "workstreams", "milestones"] as Kind[]).map(kind => <section className="schedule-panel schedule-library" key={kind} aria-labelledby={"schedule-" + kind + "-heading"}>
          <div className="schedule-panel-heading">
            <div><h2 id={"schedule-" + kind + "-heading"}>{kindLabels[kind]}s</h2>
              <p>{filtered[kind].length}{filtered[kind].length !== data[kind].length ? " of " + data[kind].length : ""} {kind === "events" ? "events" : kind}</p></div>
            {canAdd(kind) && <button type="button" className="schedule-button" disabled={busy} onClick={() => startCreate(kind)}><span aria-hidden="true">+</span> Add {names[kind]}</button>}
          </div>
          {filtered[kind].length === 0 ? <p className="schedule-empty">{data[kind].length ? "No " + kind + " match these filters." : "No active " + kind + "."}</p> : <div className="schedule-table-scroll" tabIndex={0} role="region" aria-label={kindLabels[kind] + " table"}><table>
            <thead><tr><th scope="col">Title</th><th scope="col">{kind === "workstreams" ? "Date range" : "Date"}</th><th scope="col">Partner</th><th scope="col">{kind === "events" ? "Organizer" : "Progress"}</th></tr></thead>
            <tbody>{filtered[kind].map(row => <tr key={row.id}>
              <th scope="row"><button type="button" className="schedule-title-link" onClick={() => openItem(kind, row.id)}>{row.title}</button>{kind === "events" && <small>{label(scheduleEventTypeOptions, row.event_type)}</small>}</th>
              <td className="schedule-nowrap">{dates(kind, row, displayZone)}</td><td>{row.partner_name}</td>
              <td>{kind === "events" ? row.organizer_name : <ProgressBadge value={row.progress} />}</td>
            </tr>)}</tbody>
          </table></div>}
        </section>)}
      </div>
      {formKind ? <section className="schedule-panel schedule-detail">
        {!creating && <h2>Edit {names[formKind]}</h2>}
        <ScheduleForm key={formKind + (creating ? ":new" : item?.id)} kind={formKind} item={creating ? undefined : item}
          data={data} busy={busy} onSave={values => save(formKind, creating ? "POST" : "PATCH", values, creating ? undefined : item?.id)}
          onCancel={() => { if (creating) back(); else setEditing(false); }} />
      </section> : selected ? item ? <section className="schedule-panel schedule-detail">
        <div className="schedule-badges">
          <span className="schedule-badge" data-kind={selected.kind}>{kindLabels[selected.kind]}</span>
          {selected.kind === "events" ? <span className="schedule-badge">{label(scheduleEventTypeOptions, item.event_type)}</span> : <ProgressBadge value={item.progress} />}
        </div>
        <p className="schedule-description">{item.description || item.notes || <span className="schedule-muted">No description or notes.</span>}</p>
        <dl className="schedule-facts">
          <div><dt>{selected.kind === "workstreams" ? "Date range" : "Date"}</dt><dd>{dates(selected.kind, item, displayZone)}</dd></div>
          <div><dt>{selected.kind === "events" ? "Responsible partner" : "Lead partner"}</dt><dd>{item.partner_name}</dd></div>
          {selected.kind === "events" && <>
            <div><dt>Organizer</dt><dd>{item.organizer_name}</dd></div>
            <div><dt>Workstream</dt><dd>{item.workstream_id ? data.workstreams.find(workstream => workstream.id === item.workstream_id)?.title ?? "Previous workstream (removed)" : "None"}</dd></div>
            {!item.all_day && <div><dt>Original event time</dt><dd>{dayLabel(item.event_date!)} · {item.start_time}{item.end_time ? "–" + item.end_time : ""}<small>{item.time_zone}</small></dd></div>}
          </>}
          <div><dt>Created</dt><dd>{dateTime(item.created_at)}<small>by {item.created_by_name}</small></dd></div>
          <div><dt>Last modified</dt><dd>{dateTime(item.updated_at)}<small>by {item.updated_by_name}</small></dd></div>
        </dl>
        {selected.kind === "workstreams" && <div className="schedule-related">
          <section aria-labelledby="schedule-linked-tasks">
            <h3 id="schedule-linked-tasks">Linked tasks</h3>
            {!data.tasks.some(task => task.workstream_id === item.id) ? <p className="schedule-muted">No linked tasks. Select a workstream when creating or editing a task.</p>
              : <ul className="schedule-list">{data.tasks.filter(task => task.workstream_id === item.id).map(task => <li key={task.id}>
                <button type="button" className="schedule-title-link" onClick={() => onOpenTask(task.id)}>{task.title}</button>
                <p>{label(taskProgressOptions, task.progress)} · {task.partner_name} · {task.assignee_name ?? "Unassigned"} · Due {task.due_date ? dayLabel(task.due_date) : "not set"}</p>
              </li>)}</ul>}
          </section>
          <section aria-labelledby="schedule-related-events">
            <h3 id="schedule-related-events">Related events</h3>
            {!data.events.some(event => event.workstream_id === item.id) ? <p className="schedule-muted">No related events.</p>
              : <ul className="schedule-list">{data.events.filter(event => event.workstream_id === item.id).map(event => <li key={event.id}>
                <button type="button" className="schedule-title-link" onClick={() => openItem("events", event.id)}>{event.title}</button>
                <p>{dates("events", event, displayZone)}</p>
              </li>)}</ul>}
          </section>
        </div>}
      </section> : <section className="schedule-panel schedule-detail"><p>This schedule item is no longer available.</p><button type="button" className="schedule-button" onClick={back}>Back to schedule</button></section> : null}
    </>}
  </main>;
}

function ScheduleForm({ kind, item, data, busy, onSave, onCancel }: {
  kind: Kind; item?: Item; data: ScheduleData; busy: boolean;
  onSave: (values: object) => void; onCancel: () => void;
}) {
  const availablePartners = data.partners.filter(partner => kind === "events" ? partner.members.some(member => member.can_organize) : partner.can_add_timeline);
  const [partnerId, setPartnerId] = useState(item?.partner_id ?? item?.lead_partner_id ?? availablePartners[0]?.id ?? "");
  const [allDay, setAllDay] = useState(item?.all_day ?? true);
  const members = data.partners.find(partner => partner.id === partnerId)?.members.filter(member => member.can_organize) ?? [];
  const [organizerId, setOrganizerId] = useState(item?.organizer_user_id ?? members.find(member => member.user_id === data.current_user_id)?.user_id ?? members[0]?.user_id ?? "");
  const defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (kind === "events") onSave({ ...values, partnerId, organizerUserId: organizerId, allDay });
    else onSave({ ...values, leadPartnerId: partnerId });
  }
  return <form onSubmit={submit}><fieldset className="schedule-form" disabled={busy}>
    <p className="schedule-wide"><label>Title <input name="title" required defaultValue={item?.title} /></label></p>
    <p><label>{kind === "events" ? "Responsible partner" : "Lead partner"} <select required value={partnerId} onChange={event => {
      const id = event.target.value;
      setPartnerId(id);
      setOrganizerId(data.partners.find(partner => partner.id === id)?.members.find(member => member.can_organize)?.user_id ?? "");
    }}>
      {!availablePartners.some(partner => partner.id === partnerId) && <option value={partnerId}>{item?.partner_name ?? "Select partner"}</option>}
      {availablePartners.map(partner => <option key={partner.id} value={partner.id}>{partner.legal_name}</option>)}
    </select></label></p>
    {kind === "events" ? <>
      <p><label>Organizer <select required value={organizerId} onChange={event => setOrganizerId(event.target.value)}>
        {!members.some(member => member.user_id === organizerId) && <option value={organizerId}>{item?.organizer_name ?? "Select organizer"}</option>}
        {members.map(member => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}
      </select></label></p>
      <p><label>Event type <select name="eventType" defaultValue={item?.event_type ?? "meeting"}>
        {scheduleEventTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label></p>
      <p><label>Date <input name="eventDate" type="date" required defaultValue={item?.event_date} /></label></p>
      <p className="schedule-check"><label><input type="checkbox" checked={allDay} onChange={event => setAllDay(event.target.checked)} /> All day</label></p>
      {!allDay && <>
        <p><label>Start time <input name="startTime" type="time" required defaultValue={item?.start_time ?? ""} /></label></p>
        <p><label>End time <input name="endTime" type="time" defaultValue={item?.end_time ?? ""} /></label></p>
        <p><label>Time zone <input name="timeZone" required defaultValue={item?.time_zone ?? defaultZone} placeholder="Europe/Athens" /></label></p>
        <details className="schedule-wide"><summary>Repeated times during clock changes</summary>
          <p>When a clock time occurs twice, choose which occurrence to use.</p>
          {["start", "end"].map(boundary => <p key={boundary}><label>{boundary === "start" ? "Start" : "End"} occurrence <select name={boundary + "Occurrence"} defaultValue="">
            <option value="">Choose if requested</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option>
          </select></label></p>)}
        </details>
      </>}
      <p><label>Workstream <select name="workstreamId" defaultValue={item?.workstream_id ?? ""}>
        <option value="">None</option>
        {item?.workstream_id && !data.workstreams.some(workstream => workstream.id === item.workstream_id) && <option value={item.workstream_id}>Previous workstream (removed)</option>}
        {data.workstreams.map(workstream => <option key={workstream.id} value={workstream.id}>{workstream.title}</option>)}
      </select></label></p>
      <p className="schedule-wide"><label>Notes <textarea name="notes" defaultValue={item?.notes ?? ""} /></label></p>
    </> : <>
      {kind === "workstreams" ? <>
        <p><label>Start date <input name="startDate" type="date" required defaultValue={item?.start_date} /></label></p>
        <p><label>End date <input name="endDate" type="date" required defaultValue={item?.end_date} /></label></p>
      </> : <p><label>Due date <input name="dueDate" type="date" required defaultValue={item?.due_date} /></label></p>}
      <p><label>Progress <select name="progress" defaultValue={item?.progress ?? "planned"}>
        {scheduleProgressOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label></p>
      <p className="schedule-wide"><label>Description <textarea name="description" defaultValue={item?.description ?? ""} /></label></p>
    </>}
    <div className="schedule-actions schedule-wide"><button type="submit" className="schedule-primary">Save {names[kind]}</button><button type="button" className="schedule-button" onClick={onCancel}>Cancel</button></div>
  </fieldset></form>;
}
