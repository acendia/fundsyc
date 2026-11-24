import { useCallback, useEffect, useState, type FormEvent } from "react";
import { TaskActivity } from "./TaskActivity";
import { taskProgressOptions, taskPriorityOptions } from "./models";
import type { ApiFetch, TaskList, TaskRecord } from "./api-types";
import "./TasksPage.css";

type Props = { initialTaskId?: string; proposalId: string; refreshKey: number; apiFetch: ApiFetch; onBusyChange: (busy: boolean) => void; onAccessLost: () => void };
const label = (options: readonly { value: string; label: string }[], value: string) => options.find(o => o.value === value)?.label ?? value;
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const dateTime = (value: string | null) => value ? dateTimeFormat.format(new Date(value)) : "Not assigned";
const assignedDay = (value: string | null) => value ? dayFormat.format(new Date(value)) : "Not assigned";
// due dates are calendar days, build them locally so they never shift a day
const dueLabel = (value: string | null) => { if (!value) return "No due date"; const [y, m, d] = value.split("-").map(Number); return dayFormat.format(new Date(y, m - 1, d)); };
// legacy assignee_name only if the assignees list is missing.
const assigneeNames = (item: TaskRecord) => item.assignees ? item.assignees.map(a => a.display_name).join(", ") || "Unassigned" : item.assignee_name ?? "Unassigned";
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 21l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></svg>;
}

function ProgressBadge({ value }: { value: string }) {
  return <span className="tasks-badge" data-progress={value}>{label(taskProgressOptions, value)}</span>;
}

function PriorityBadge({ value }: { value: string }) {
  return <span className="tasks-badge" data-priority={value}>{label(taskPriorityOptions, value)}</span>;
}

function Assignees({ item }: { item: TaskRecord }) {
  const people = item.assignees ?? [];
  if (!people.length) return <span className="tasks-muted">{assigneeNames(item)}</span>;
  return <ul className="tasks-people">{people.map(person => <li key={person.user_id}><span aria-hidden="true">{initials(person.display_name)}</span>{person.display_name}</li>)}</ul>;
}

export function TasksPage({ initialTaskId, proposalId, refreshKey, apiFetch, onBusyChange, onAccessLost }: Props) {
  const [data, setData] = useState<TaskList | null>(null);
  const [view, setView] = useState<"board" | "list">("list");
  const [search, setSearch] = useState("");
  const [progressFilter, setProgressFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [partnerFilter, setPartnerFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [myTasks, setMyTasks] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialTaskId ?? null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const refreshTasks = useCallback(() => setRevision(value => value + 1), []);
  const path = `/api/proposals/${proposalId}/tasks`;
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(path, { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) { setData(null); if (response.status === 403) onAccessLost(); throw new Error(result.error || "Could not load tasks."); }
      setData(result); setError("");
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [path, revision, refreshKey, apiFetch, onAccessLost]);
  async function save(method: string, values?: object, id?: string) {
    setBusy(true); setMessage("");
    try {
      const response = await apiFetch(`${path}${id ? `/${id}` : ""}`, { method, headers: { "Content-Type": "application/json" }, body: values ? JSON.stringify(values) : undefined });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The Tasks API is unavailable. Restart the local app and try again.");
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 403) setRevision(r => r + 1);
        // someone else saved first, keep the form and reload the latest task so the user can retry
        if (result.code === "task_changed") { setStale(true); setRevision(r => r + 1); }
        throw new Error(result.error || "Could not save task.");
      }
      setCreating(false); setEditing(false); setStale(false); setSelected(method === "DELETE" ? null : result.id);
      setMessage(method === "DELETE" ? "Task marked as removed." : "Task saved."); setRevision(r => r + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save task."); }
    finally { setBusy(false); }
  }
  const now = new Date();
  // due dates are calendar dates, use the local day instead of converting to utc
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const searchTitle = search.trim().toLowerCase();
  const filteredTasks = data?.tasks.filter(item => {
    if (!item.title.toLowerCase().includes(searchTitle)) return false;
    if (progressFilter && item.progress !== progressFilter) return false;
    if (priorityFilter && item.priority !== priorityFilter) return false;
    if (partnerFilter && item.partner_id !== partnerFilter) return false;
    if (assigneeFilter === "unassigned" && item.assignees.length) return false;
    if (assigneeFilter && assigneeFilter !== "unassigned" && !item.assignees.some(a => a.user_id === assigneeFilter)) return false;
    if (myTasks && !item.assignees.some(a => a.user_id === data.current_user_id)) return false;
    if (overdueOnly && (!item.due_date || item.due_date >= today || item.progress === "completed")) return false;
    return true;
  }) ?? [];
  const partnerOptions = new Map(data?.partners.map(partner => [partner.id, partner.legal_name]));
  const assigneeOptions = new Map(data?.partners.flatMap(partner => partner.members.map(member => [member.user_id, member.display_name] as const)));
  for (const item of data?.tasks ?? []) {
    partnerOptions.set(item.partner_id, item.partner_name);
    for (const assignee of item.assignees) assigneeOptions.set(assignee.user_id, assignee.display_name);
  }
  function clearFilters() {
    setSearch("");
    setProgressFilter("");
    setPriorityFilter("");
    setPartnerFilter("");
    setAssigneeFilter("");
    setMyTasks(false);
    setOverdueOnly(false);
  }
  const task = data?.tasks.find(t => t.id === selected);
  function openTask(id: string) {
    setSelected(id);
    setEditing(false);
    setStale(false);
    setMessage("");
  }
  function back() { setSelected(null); setEditing(false); setCreating(false); setStale(false); setMessage(""); }
  const isOverdue = (item: TaskRecord) => Boolean(item.due_date && item.due_date < today && item.progress !== "completed");
  const filterCount = [progressFilter, priorityFilter, partnerFilter, assigneeFilter, myTasks, overdueOnly].filter(Boolean).length;
  const readOnly = data ? ["submitted", "archived"].includes(data.proposal.status) : false;
  const statusText = data ? data.proposal.status.replace(/_/g, " ") : "";
  return <main className="proposal-overview tasks-page">
    <header className="overview-heading overview-heading-row tasks-heading">
      <div>
        {(selected || creating) && <button type="button" className="overview-link" disabled={busy} onClick={back}>← Back to tasks</button>}
        <h1>{creating ? "Add task" : task?.title ?? "Tasks"}</h1>
        <p>{creating ? "Create a task and assign it to a partner." : task ? <>{task.partner_name}{task.workstream_title ? ` · ${task.workstream_title}${task.workstream_status === "removed" ? " (removed)" : ""}` : ""}</> : "Plan, assign and follow the work needed for this proposal."}</p>
      </div>
      {data && !selected && !creating && data.can_add && <button type="button" className="tasks-primary" disabled={busy} onClick={() => { setCreating(true); setMessage(""); }}><span aria-hidden="true">+</span> Add task</button>}
      {data && task && !editing && (task.can_edit || task.can_remove) && <div className="tasks-actions">
        {task.can_edit && <button type="button" className="tasks-button" disabled={busy} onClick={() => { setEditing(true); setStale(false); setMessage(""); }}>Edit task</button>}
        {task.can_remove && <button type="button" className="tasks-button tasks-danger" disabled={busy} onClick={() => { if (window.confirm(`Mark ${task.title} as removed? Its comments will be kept.`)) void save("DELETE", undefined, task.id); }}>Remove task</button>}
      </div>}
    </header>
    {message && <p className="tasks-feedback" role="status">{message}</p>}{error && <p className="tasks-feedback" role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading tasks…</p>}
    {data && <>
      {readOnly && <p className="tasks-feedback">This proposal is {statusText} and read-only.</p>}
      {creating ? <section className="overview-panel tasks-panel"><TaskForm data={data} busy={busy} onSave={values => save("POST", values)} onCancel={back} /></section> : selected ? task ? <section className="overview-panel tasks-panel">
        {editing && task.can_edit ? <>
          <h2>Edit task</h2>
          <TaskForm key={task.id} task={task} data={data} busy={busy} stale={stale} onStaleAccepted={() => setStale(false)} onDiscard={() => { setEditing(false); setStale(false); setRevision(r => r + 1); setMessage("Your unsaved changes were discarded. Showing the latest saved task."); }} onSave={values => save("PATCH", values, task.id)} onCancel={() => { setEditing(false); setStale(false); }} />
        </> : <>
          <div className="tasks-badges"><ProgressBadge value={task.progress} /><PriorityBadge value={task.priority} />{isOverdue(task) && <span className="tasks-badge" data-overdue="true">Overdue</span>}</div>
          <p className="tasks-description">{task.description || <span className="tasks-muted">No description</span>}</p>
          <dl className="tasks-facts">
            <div><dt>Partner</dt><dd>{task.partner_name}</dd></div>
            <div><dt>Assignees</dt><dd><Assignees item={task} /></dd></div>
            <div><dt>Due date</dt><dd className={isOverdue(task) ? "tasks-overdue" : undefined}>{dueLabel(task.due_date)}</dd></div>
            <div><dt>Workstream</dt><dd>{task.workstream_title ? task.workstream_title + (task.workstream_status === "removed" ? " (removed)" : "") : "None"}</dd></div>
            <div><dt>Assigned</dt><dd>{dateTime(task.assigned_at)}</dd></div>
            <div><dt>Created</dt><dd>{dateTime(task.created_at)}<small>by {task.created_by_name}</small></dd></div>
            <div><dt>Last modified</dt><dd>{dateTime(task.updated_at)}<small>by {task.updated_by_name}</small></dd></div>
          </dl>
          <TaskActivity key={task.id} proposalId={proposalId} taskId={task.id} refreshKey={revision + refreshKey} apiFetch={apiFetch} busy={busy} onBusyChange={setBusy} onChange={refreshTasks} onAccessLost={refreshTasks} />
        </>}
      </section> : <section className="overview-panel tasks-panel"><p>This task is no longer available.</p><button type="button" className="tasks-button" onClick={back}>Back to tasks</button></section> : <>
        <div className="tasks-summary" role="group" aria-label="Filter tasks by progress">
          {taskProgressOptions.map(option => {
            const count = data.tasks.filter(item => item.progress === option.value).length;
            return <button key={option.value} type="button" className="tasks-summary-card" data-progress={option.value} aria-pressed={progressFilter === option.value} onClick={() => setProgressFilter(progressFilter === option.value ? "" : option.value)}>
              <strong>{count}</strong><span>{option.label}</span>
            </button>;
          })}
          <button type="button" className="tasks-summary-card" data-overdue="true" aria-pressed={overdueOnly} onClick={() => setOverdueOnly(!overdueOnly)}>
            <strong>{data.tasks.filter(isOverdue).length}</strong><span>Overdue</span>
          </button>
        </div>
        <section className="tasks-library" aria-labelledby="tasks-library-heading">
          <div className="tasks-library-heading">
            <div>
              <h2 id="tasks-library-heading">{progressFilter ? label(taskProgressOptions, progressFilter) : "Active tasks"}</h2>
              <p role="status">Showing {filteredTasks.length} of {data.tasks.length} {data.tasks.length === 1 ? "task" : "tasks"} · Proposal status: {statusText}</p>
            </div>
            <div className="tasks-tools">
              <div className="tasks-search"><SearchIcon /><input type="search" aria-label="Search task titles" placeholder="Search tasks" value={search} onChange={event => setSearch(event.target.value)} /></div>
              <div className="tasks-view" role="group" aria-label="Task view">
                <button type="button" aria-pressed={view === "list"} disabled={busy} onClick={() => setView("list")}>List</button>
                <button type="button" aria-pressed={view === "board"} disabled={busy} onClick={() => setView("board")}>Board</button>
              </div>
              <button type="button" className="tasks-button" aria-expanded={showFilters} aria-controls="tasks-filters" onClick={() => setShowFilters(!showFilters)}>Filter{filterCount > 0 && <span className="tasks-count">{filterCount}</span>}</button>
            </div>
          </div>
          <div id="tasks-filters" className="tasks-filters" role="group" aria-label="Task filters" hidden={!showFilters}>
            <label>Progress <select value={progressFilter} onChange={event => setProgressFilter(event.target.value)}>
              <option value="">All progress</option>{taskProgressOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label>
            <label>Priority <select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)}>
              <option value="">All priorities</option>{taskPriorityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label>
            <label>Partner <select value={partnerFilter} onChange={event => setPartnerFilter(event.target.value)}>
              <option value="">All partners</option>{Array.from(partnerOptions).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <label>Assignee <select value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)}>
              <option value="">All assignees</option><option value="unassigned">Unassigned</option>{Array.from(assigneeOptions).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <label className="tasks-check"><input type="checkbox" checked={myTasks} onChange={event => setMyTasks(event.target.checked)} /> My tasks</label>
            <label className="tasks-check"><input type="checkbox" checked={overdueOnly} onChange={event => setOverdueOnly(event.target.checked)} /> Overdue</label>
            <button type="button" className="overview-link" onClick={clearFilters}>Clear filters</button>
          </div>
          {filteredTasks.length === 0 ? <div className="tasks-empty">
            <p>{data.tasks.length === 0 ? "No tasks yet." : "No tasks match these filters."}</p>
            {data.tasks.length !== 0 && <button type="button" className="overview-link" onClick={clearFilters}>Clear filters</button>}
          </div> : view === "board" ? <div className="tasks-board" aria-label="Task board">
            {taskProgressOptions.map(option => {
              const tasks = filteredTasks.filter(item => item.progress === option.value);
              return <section className="tasks-column" data-progress={option.value} key={option.value} aria-labelledby={`task-column-${option.value}`}>
                <h3 id={`task-column-${option.value}`}>{option.label} <span className="tasks-count">{tasks.length}</span></h3>
                {tasks.length === 0 && <p className="tasks-muted">No tasks.</p>}
                {tasks.map(item => <article className="tasks-card" key={item.id}>
                  <PriorityBadge value={item.priority} />
                  <h4><button type="button" className="tasks-title-link" disabled={busy} onClick={() => openTask(item.id)}>{item.title}</button></h4>
                  {item.description && <p className="tasks-description">{item.description.length > 180 ? `${item.description.slice(0, 180).trimEnd()}…` : item.description}</p>}
                  <dl>
                    <div><dt>Partner</dt><dd>{item.partner_name}</dd></div>
                    <div><dt>Assignee</dt><dd>{assigneeNames(item)}</dd></div>
                    <div><dt>Assigned</dt><dd>{assignedDay(item.assigned_at)}</dd></div>
                    <div><dt>Due</dt><dd className={isOverdue(item) ? "tasks-overdue" : undefined}>{dueLabel(item.due_date)}</dd></div>
                    <div><dt>Comments</dt><dd>{item.comment_count}</dd></div>
                  </dl>
                </article>)}
              </section>;
            })}
          </div> : <div className="tasks-table-scroll" tabIndex={0} role="region" aria-label="Task table">
            <table><thead><tr>{["Task", "Progress", "Priority", "Partner", "Assignees", "Due date", "Comments", "Details"].map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>{filteredTasks.map(t => <tr key={t.id}>
              <th scope="row"><button type="button" className="tasks-title-link" disabled={busy} onClick={() => openTask(t.id)}>{t.title}</button>{t.workstream_title && <small>{t.workstream_title}{t.workstream_status === "removed" ? " (removed)" : ""}</small>}</th>
              <td><ProgressBadge value={t.progress} /></td>
              <td><PriorityBadge value={t.priority} /></td>
              <td>{t.partner_name}</td>
              <td><Assignees item={t} />{t.assigned_at && <small>Assigned {assignedDay(t.assigned_at)}</small>}</td>
              <td className={isOverdue(t) ? "tasks-date tasks-overdue" : "tasks-date"}>{dueLabel(t.due_date)}{isOverdue(t) && <small>Overdue</small>}</td>
              <td>{t.comment_count}</td>
              <td><button type="button" className="tasks-view-button" aria-label={`View ${t.title}`} disabled={busy} onClick={() => openTask(t.id)}>View <span aria-hidden="true">›</span></button></td>
            </tr>)}</tbody></table>
          </div>}
        </section>
        {!data.can_add && <p className="tasks-muted">You can view tasks. Adding and editing requires an editable proposal and an appropriate role.</p>}
      </>}
    </>}
  </main>;
}

function TaskForm({ data, task, busy, stale = false, onStaleAccepted, onDiscard, onSave, onCancel }: { data: TaskList; task?: TaskRecord; busy: boolean; stale?: boolean; onStaleAccepted?: () => void; onDiscard?: () => void; onSave: (values: object) => Promise<void>; onCancel: () => void }) {
  const partners = data.partners.filter(p => p.can_create);
  const initialPartner = partners.find(p => p.members.some(m => m.user_id === data.current_user_id)) ?? partners[0];
  const [partnerId, setPartnerId] = useState(task?.partner_id ?? initialPartner?.id ?? "");
  // the version this form was opened with, a save is rejected if the task changed since
  const [expectedVersion, setExpectedVersion] = useState(task?.version);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task ? task.assignees.map(a => a.user_id) : initialPartner?.members.some(m => m.user_id === data.current_user_id) ? [data.current_user_id] : []);
  const members = data.partners.find(p => p.id === partnerId)?.members ?? [];
  // inactive assignees stay checked so they are kept on save.
  const inactiveIds = assigneeIds.filter(id => !members.some(m => m.user_id === id));
  const canAssign = task ? task.can_assign : data.can_assign_new;
  function toggleAssignee(userId: string, checked: boolean) {
    setAssigneeIds(ids => checked ? [...ids, userId] : ids.filter(id => id !== userId));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSave({ ...Object.fromEntries(new FormData(event.currentTarget)), partnerId, assigneeUserIds: assigneeIds, ...(task ? { expectedVersion } : {}) });
  }
  // the form keeps the user's input, the banner only shows what was saved since
  return <form onSubmit={submit}>
    {task && stale && <div className="tasks-stale" role="alert">
      <p>Someone else saved this task after you opened it. Saving this form will overwrite their changes.</p>
      <p>Latest saved: {task.title}, progress {label(taskProgressOptions, task.progress)}, priority {label(taskPriorityOptions, task.priority)}, assignees {assigneeNames(task)}, due date {task.due_date ?? "None"}.</p>
      <p>This form still shows your own values, not the latest saved values.</p>
      <div className="tasks-actions">
        <button type="button" className="tasks-button" disabled={busy || expectedVersion === task.version} onClick={() => { setExpectedVersion(task.version); onStaleAccepted?.(); }}>Overwrite their changes</button>
        <button type="button" className="tasks-button" disabled={busy} onClick={() => onDiscard?.()}>Discard my changes and reload</button>
      </div>
    </div>}
    <fieldset className="tasks-form" disabled={busy}>
    <label className="tasks-wide">Title <input name="title" defaultValue={task?.title ?? ""} required /></label>
    <label className="tasks-wide">Description <textarea name="description" defaultValue={task?.description ?? ""} /></label>
    <label>Progress <select name="progress" defaultValue={task?.progress ?? "todo"}>{taskProgressOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    <label>Priority <select name="priority" defaultValue={task?.priority ?? "medium"}>{taskPriorityOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    <label>Partner <select value={partnerId} disabled={!canAssign} required onChange={event => { setPartnerId(event.target.value); setAssigneeIds([]); }}>
      {!partners.some(p => p.id === partnerId) && task && <option value={task.partner_id}>{task.partner_name} (previous partner)</option>}
      {partners.map(p => <option key={p.id} value={p.id}>{p.legal_name}</option>)}
    </select></label>
    <label>Workstream <select name="workstreamId" defaultValue={task?.workstream_id ?? ""}>
      <option value="">None</option>
      {task?.workstream_id && !data.workstreams.some(workstream => workstream.id === task.workstream_id)
        && <option value={task.workstream_id}>{task.workstream_title ?? "Previous workstream"} (removed)</option>}
      {data.workstreams.map(workstream => <option key={workstream.id} value={workstream.id}>{workstream.title}</option>)}
    </select></label>
    <fieldset className="tasks-assignees tasks-wide" disabled={!canAssign}><legend>Assignees</legend>
      <div>
        {inactiveIds.map(id => <label key={id}><input type="checkbox" checked onChange={event => toggleAssignee(id, event.target.checked)} /> {task?.assignees.find(a => a.user_id === id)?.display_name ?? "Previous assignee"} (inactive)</label>)}
        {members.map(m => <label key={m.user_id}><input type="checkbox" checked={assigneeIds.includes(m.user_id)} onChange={event => toggleAssignee(m.user_id, event.target.checked)} /> {m.display_name}</label>)}
        {!inactiveIds.length && !members.length && <p>No active members in this partner.</p>}
      </div>
    </fieldset>
    <label>Due date <input name="dueDate" type="date" defaultValue={task?.due_date ?? ""} /></label>
    <div className="tasks-actions tasks-wide"><button className="tasks-primary">{task ? "Save changes" : "Create task"}</button><button type="button" className="tasks-button" onClick={onCancel}>Cancel</button></div>
  </fieldset></form>;
}
