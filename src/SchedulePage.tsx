import { useEffect, useState, type FormEvent } from "react";
import { emptyScheduleFilters, matchesScheduleFilters } from "./schedule-filters";
import { ScheduleTimeline } from "./ScheduleTimeline";
import { ScheduleCalendar } from "./ScheduleCalendar";
import { calendarEntries, entryTime, dateInZone } from "./schedule-calendar";
import { scheduleEventTypeOptions, scheduleProgressOptions, taskProgressOptions } from "./models";
import type { ApiFetch } from "./api-types";

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
  onOpenTask: (id: string) => void;
  proposalId: string;
  refreshKey: number;
  apiFetch: ApiFetch;
  onBusyChange: (busy: boolean) => void;
  onAccessLost: () => void;
};
const names: Record<Kind, string> = { events: "event", workstreams: "workstream", milestones: "milestone" };
const label = (options: readonly { value: string; label: string }[], value?: string) => options.find(option => option.value === value)?.label ?? value;
const dates = (kind: Kind, item: Item, timeZone: string) => {
  if (kind === "workstreams") return item.start_date + " – " + item.end_date;
  if (kind === "milestones") return item.due_date;
  if (item.all_day) return item.event_date + " · All day";
  const entry = calendarEntries([item], [], timeZone)[0];
  return entry.date + " · " + entryTime(entry) + " · " + timeZone;
};

export function SchedulePage({ onOpenTask, proposalId, refreshKey, apiFetch, onBusyChange, onAccessLost }: Props) {
  const [filters, setFilters] = useState({ ...emptyScheduleFilters });
  const [displayZone, setDisplayZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [data, setData] = useState<ScheduleData | null>(null);
  const [selected, setSelected] = useState<{ kind: Kind; id: string } | null>(null);
  const [creating, setCreating] = useState<Kind | null>(null);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const path = "/api/proposals/" + proposalId + "/schedule";
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    const controller = new AbortController();
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
      setError("");
    }).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [path, refreshKey, revision, apiFetch, onAccessLost]);

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
  return <main>
    <h1>Schedule</h1>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>Loading schedule...</p>}
    {data && <>
      {["submitted", "archived"].includes(data.proposal.status) && <p>This proposal is read-only.</p>}
      <div hidden={Boolean(creating || selected)}>
        <section className="section section-records" aria-label="Schedule filters">
          <p><label>Search title <input type="search" value={filters.title} onChange={event => setFilters({ ...filters, title: event.target.value })} /></label></p>
          <p><label>Item type <select value={filters.type} onChange={event => setFilters({ ...filters, type: event.target.value })}>
            <option value="">All item types</option><option value="events">All events</option>
            {scheduleEventTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            <option value="workstreams">Workstreams</option><option value="milestones">Milestones</option><option value="tasks">Task deadlines</option>
          </select></label></p>
          <p><label>Partner filter <select value={filters.partner} onChange={event => setFilters({ ...filters, partner: event.target.value })}>
            <option value="">All partners</option>{Array.from(partners).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select></label></p>
          <p><label>Organizer (events) <select value={filters.organizer} onChange={event => setFilters({ ...filters, organizer: event.target.value })}>
            <option value="">All organizers</option>{Array.from(organizers).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select></label></p>
          <p><label>Progress filter <select value={filters.progress} onChange={event => setFilters({ ...filters, progress: event.target.value })}>
            <option value="">All progress</option>
            <optgroup label="Workstreams and milestones">{scheduleProgressOptions.map(option => <option key={option.value} value={"timeline:" + option.value}>{option.label}</option>)}</optgroup>
            <optgroup label="Tasks">{taskProgressOptions.map(option => <option key={option.value} value={"task:" + option.value}>{option.label}</option>)}</optgroup>
          </select></label></p>
          <button type="button" onClick={() => setFilters({ ...emptyScheduleFilters })}>Clear filters</button>
          <p role="status">Matching across all dates: {filtered.events.length} events, {filtered.workstreams.length} workstreams, {filtered.milestones.length} milestones, {filtered.tasks.length} task deadlines.</p>
        </section>
        <ScheduleCalendar events={filtered.events} milestones={filtered.milestones} tasks={filtered.tasks} timeZone={displayZone} onTimeZoneChange={setDisplayZone}
          onOpen={(kind, id) => { if (kind === "tasks") onOpenTask(id); else setSelected({ kind, id }); setMessage(""); }} />
        <ScheduleTimeline workstreams={filtered.workstreams} milestones={filtered.milestones} today={dateInZone(new Date(), displayZone)}
          onOpen={(kind, id) => { setSelected({ kind, id }); setMessage(""); }} />
      </div>
      {formKind ? <section className="section section-create">
        <h2>{creating ? "Add" : "Edit"} {names[formKind]}</h2>
        <ScheduleForm key={formKind + (creating ? ":new" : item?.id)} kind={formKind} item={creating ? undefined : item}
          data={data} busy={busy} onSave={values => save(formKind, creating ? "POST" : "PATCH", values, creating ? undefined : item?.id)}
          onCancel={() => { if (creating) back(); else setEditing(false); }} />
      </section> : selected ? item ? <section className="section section-partner">
        <button type="button" disabled={busy} onClick={back}>Back to schedule</button>
        <h2>{item.title}</h2>
        <p>{dates(selected.kind, item, displayZone)}</p>
        <p>Responsible partner: {item.partner_name}</p>
        {selected.kind === "events" ? <>
          {!item.all_day && <p>Original event time: {item.event_date} · {item.start_time}{item.end_time ? "–" + item.end_time : ""} · {item.time_zone}</p>}
          <p>Type: {label(scheduleEventTypeOptions, item.event_type)}</p>
          <p>Organizer: {item.organizer_name}</p>
          <p>Workstream: {item.workstream_id ? data.workstreams.find(workstream => workstream.id === item.workstream_id)?.title ?? "Previous workstream (removed)" : "None"}</p>
        </> : <p>Progress: {label(scheduleProgressOptions, item.progress)}</p>}
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.description || item.notes || "No description or notes."}</p>
        {selected.kind === "workstreams" && <>
          <h3>Linked tasks</h3>
          {!data.tasks.some(task => task.workstream_id === item.id) && <p>No linked tasks. Select a workstream when creating or editing a task.</p>}
          <ul>{data.tasks.filter(task => task.workstream_id === item.id).map(task => <li key={task.id}>
            <button type="button" onClick={() => onOpenTask(task.id)}>{task.title}</button>
            {" · "}{label(taskProgressOptions, task.progress)} · {task.partner_name} · {task.assignee_name ?? "Unassigned"} · Due: {task.due_date ?? "None"}
          </li>)}</ul>
          <h3>Related events</h3>
          {!data.events.some(event => event.workstream_id === item.id) && <p>No related events.</p>}
          <ul>{data.events.filter(event => event.workstream_id === item.id).map(event => <li key={event.id}>
            <button type="button" onClick={() => setSelected({ kind: "events", id: event.id })}>{event.title}</button>
            {" · "}{dates("events", event, displayZone)}
          </li>)}</ul>
        </>}
        <p>Created by {item.created_by_name} on {new Date(item.created_at).toLocaleString()}</p>
        <p>Last modified by {item.updated_by_name} on {new Date(item.updated_at).toLocaleString()}</p>
        {item.can_edit && <button type="button" disabled={busy} onClick={() => { setEditing(true); setMessage(""); }}>Edit {names[selected.kind]}</button>}{" "}
        {item.can_remove && <button type="button" disabled={busy} onClick={() => {
          if (window.confirm("Mark " + item.title + " as removed? Its record will be kept.")) void save(selected.kind, "DELETE", undefined, item.id);
        }}>Remove {names[selected.kind]}</button>}
      </section> : <><p>This schedule item is no longer available.</p><button type="button" onClick={back}>Back to schedule</button></> : <>
        {(["events", "workstreams", "milestones"] as Kind[]).map(kind => {
          const canAdd = data.partners.some(partner => kind === "events" ? partner.members.some(member => member.can_organize) : partner.can_add_timeline);
          return <section className="section section-partner" key={kind}>
            <h2>{kind === "events" ? "Events" : kind === "workstreams" ? "Workstreams" : "Milestones"}</h2>
            {canAdd && <p><button type="button" onClick={() => { setCreating(kind); setMessage(""); }}>Add {names[kind]}</button></p>}
            {filtered[kind].length === 0 ? <p>{data[kind].length ? "No " + kind + " match these filters." : "No active " + kind + "."}</p> : <div className="schedule-records-scroll"><table>
              <thead><tr><th>Title</th><th>{kind === "workstreams" ? "Date range" : "Date"}</th><th>Partner</th><th>{kind === "events" ? "Organizer" : "Progress"}</th></tr></thead>
              <tbody>{filtered[kind].map(item => <tr key={item.id}>
                <td><button type="button" onClick={() => { setSelected({ kind, id: item.id }); setMessage(""); }}>{item.title}</button></td>
                <td>{dates(kind, item, displayZone)}</td><td>{item.partner_name}</td>
                <td>{kind === "events" ? item.organizer_name : label(scheduleProgressOptions, item.progress)}</td>
              </tr>)}</tbody>
            </table></div>}
          </section>;
        })}
      </>}
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
  return <form onSubmit={submit}><fieldset disabled={busy}>
    <p><label>Title <input name="title" required defaultValue={item?.title} /></label></p>
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
      <p><label><input type="checkbox" checked={allDay} onChange={event => setAllDay(event.target.checked)} /> All day</label></p>
      {!allDay && <>
        <p><label>Start time <input name="startTime" type="time" required defaultValue={item?.start_time ?? ""} /></label></p>
        <p><label>End time <input name="endTime" type="time" defaultValue={item?.end_time ?? ""} /></label></p>
        <p><label>Time zone <input name="timeZone" required defaultValue={item?.time_zone ?? defaultZone} placeholder="Europe/Athens" /></label></p>
        <details><summary>Repeated times during clock changes</summary>
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
      <p><label>Notes <textarea name="notes" defaultValue={item?.notes ?? ""} /></label></p>
    </> : <>
      {kind === "workstreams" ? <>
        <p><label>Start date <input name="startDate" type="date" required defaultValue={item?.start_date} /></label></p>
        <p><label>End date <input name="endDate" type="date" required defaultValue={item?.end_date} /></label></p>
      </> : <p><label>Due date <input name="dueDate" type="date" required defaultValue={item?.due_date} /></label></p>}
      <p><label>Progress <select name="progress" defaultValue={item?.progress ?? "planned"}>
        {scheduleProgressOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label></p>
      <p><label>Description <textarea name="description" defaultValue={item?.description ?? ""} /></label></p>
    </>}
    <button type="submit">Save {names[kind]}</button>{" "}
    <button type="button" onClick={onCancel}>Cancel</button>
  </fieldset></form>;
}
