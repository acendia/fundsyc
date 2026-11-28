import { useEffect, useRef, useState, type FormEvent } from "react";
import { requirementCategoryOptions, taskPriorityOptions, taskProgressOptions } from "../models";
import type { ApiFetch, RequirementList, RequirementRecord } from "../api-types";

type Props = { initialRequirementId?: string; proposalId: string; refreshKey: number; apiFetch: ApiFetch; onBusyChange: (busy: boolean) => void; onAccessLost: () => void; onOpenTask: (id: string) => void };
type Notice = { code: string; requirement: string; error: string; unfinished: { id: string; title: string; progress: string }[]; removed: { id: string; title: string }[] };

const pageSize = 20;
const progressLabels: Record<string, string> = { not_started: "Not started", in_progress: "In progress", in_review: "In review", completed: "Completed" };
const attentionLabels: Record<string, string> = { overdue: "Overdue", linked_task_removed: "Linked task removed", responsible_inactive: "Owner or institution is no longer active" };
const label = (options: readonly { value: string; label: string }[], value: string) => options.find(option => option.value === value)?.label ?? value;
// due dates are calendar dates, so the local day is used instead of converting to utc
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const unavailable = "The Requirements API is unavailable. Restart the local app and try again.";

async function readJson(response: Response) {
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(unavailable);
  return response.json();
}

export function RequirementsPage({ initialRequirementId, proposalId, refreshKey, apiFetch, onBusyChange, onAccessLost, onOpenTask }: Props) {
  const [data, setData] = useState<RequirementList | null>(null);
  const [selected, setSelected] = useState<string | null>(initialRequirementId ?? null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tab, setTab] = useState<"all" | "mine" | "attention">("all");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [partnerFilter, setPartnerFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [progressFilter, setProgressFilter] = useState("");
  const [page, setPage] = useState(1);
  // only tell the app once per lost access, otherwise a repeated 403 would refresh forever
  const lostRef = useRef(false);
  const path = `/api/proposals/${proposalId}/requirements`;
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`${path}?today=${localToday()}`, { signal: controller.signal }).then(async response => {
      const result = await readJson(response);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setData(null);
        if (response.status === 403 && !lostRef.current) { lostRef.current = true; onAccessLost(); }
        throw new Error(result.error || "Could not load requirements.");
      }
      lostRef.current = false;
      setData(result); setError("");
    }).catch(failure => { if (!controller.signal.aborted) { setData(null); setError(failure instanceof Error ? failure.message : "Could not load requirements."); } });
    return () => controller.abort();
  }, [path, revision, refreshKey, apiFetch, onAccessLost]);

  // every write goes through here, so busy state and errors behave the same
  async function send(method: string, url: string, values?: object): Promise<{ id: string; code?: string } | null> {
    setBusy(true); setMessage(""); setNotice(null);
    try {
      const response = await apiFetch(path + url, { method, headers: values ? { "Content-Type": "application/json" } : undefined, body: values ? JSON.stringify(values) : undefined });
      const result = await readJson(response);
      if (!response.ok) {
        if ([403, 404, 409].includes(response.status)) setRevision(value => value + 1);
        throw new Error(result.error || "Could not save this change.");
      }
      setRevision(value => value + 1);
      return result;
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Could not save this change.");
      return null;
    } finally { setBusy(false); }
  }

  // the server decides if the box can change, so the checkbox always asks it
  async function toggle(item: RequirementRecord) {
    setBusy(true); setMessage(""); setNotice(null);
    try {
      const response = await apiFetch(`${path}/${item.id}/completion`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: !item.completed }) });
      const result = await readJson(response);
      if (!response.ok) {
        if ([403, 404, 409].includes(response.status)) setRevision(value => value + 1);
        if (result.code === "unfinished_linked_tasks" || result.code === "automatically_completed") {
          setNotice({ code: result.code, requirement: `${item.code} ${item.title}`, error: result.error, unfinished: result.unfinished_tasks ?? [], removed: result.removed_tasks ?? [] });
          return;
        }
        throw new Error(result.error || "Could not change this requirement.");
      }
      setMessage(`${item.code} marked as ${result.completed ? "completed" : "not completed"}.`);
      setRevision(value => value + 1);
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Could not change this requirement."); }
    finally { setBusy(false); }
  }

  async function saveForm(values: object, item?: RequirementRecord) {
    const result = await send(item ? "PATCH" : "POST", item ? "/" + item.id : "", values);
    if (!result) return;
    setCreating(false); setEditing(false);
    setMessage(item ? "Requirement saved." : `Requirement ${result.code} added.`);
    if (!item) setSelected(result.id);
  }
  async function removeRequirement(item: RequirementRecord) {
    if (!window.confirm(`Mark ${item.code} ${item.title} as removed? Its linked tasks will not be changed.`)) return;
    const result = await send("DELETE", "/" + item.id);
    if (result) { setSelected(null); setEditing(false); setMessage("Requirement marked as removed."); }
  }

  function filtered(items: RequirementRecord[]) {
    const term = search.trim().toLowerCase();
    return items.filter(item => {
      if (tab === "mine" && item.owner_user_id !== data?.current_user_id) return false;
      if (tab === "attention" && item.attention.length === 0) return false;
      if (term && !item.title.toLowerCase().includes(term) && !item.code.toLowerCase().includes(term)) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (ownerFilter && item.owner_user_id !== ownerFilter) return false;
      if (partnerFilter && item.partner_id !== partnerFilter) return false;
      if (priorityFilter && item.priority !== priorityFilter) return false;
      if (progressFilter && item.progress !== progressFilter) return false;
      return true;
    });
  }
  // a filter change always starts again from the first page
  const changeFilter = (setter: (value: string) => void) => (event: { target: { value: string } }) => { setter(event.target.value); setPage(1); };
  function clearFilters() {
    setSearch(""); setCategoryFilter(""); setOwnerFilter(""); setPartnerFilter(""); setPriorityFilter(""); setProgressFilter(""); setTab("all"); setPage(1);
  }

  const today = localToday();
  const item = data?.requirements.find(row => row.id === selected);
  const rows = data ? filtered(data.requirements) : [];
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  const visible = rows.slice((current - 1) * pageSize, current * pageSize);
  const owners = new Map(data?.requirements.filter(row => row.owner_user_id).map(row => [row.owner_user_id as string, row.owner_name ?? "Unknown"]));
  const partners = new Map(data?.requirements.filter(row => row.partner_id).map(row => [row.partner_id as string, row.partner_name ?? "Unknown"]));
  const inForm = creating || (editing && item?.can_edit);

  return <main>
    <h1>Requirements</h1>
    <p>Track eligibility, administrative and submission requirements.</p>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>Loading requirements...</p>}
    {notice && <section role="alert">
      <p><strong>{notice.requirement}</strong></p>
      <p>{notice.error}</p>
      {notice.unfinished.length > 0 && <><p>Unfinished linked tasks:</p>
        <ul>{notice.unfinished.map(task => <li key={task.id}><button type="button" onClick={() => onOpenTask(task.id)}>{task.title}</button> — {label(taskProgressOptions, task.progress)}</li>)}</ul></>}
      {notice.removed.length > 0 && <><p>Removed linked tasks. Edit the requirement to unlink them:</p>
        <ul>{notice.removed.map(task => <li key={task.id}>{task.title}</li>)}</ul></>}
      <button type="button" onClick={() => setNotice(null)}>Dismiss</button>
    </section>}
    {data && (inForm ? <section className="section section-create">
      <h2>{creating ? "Add requirement" : "Edit requirement"}</h2>
      <RequirementForm key={creating ? "new" : `${item?.id}:${item?.version}`} data={data} item={creating ? undefined : item} busy={busy}
        onSave={values => void saveForm(values, creating ? undefined : item)} onCancel={() => { setCreating(false); setEditing(false); }} />
    </section> : selected ? item ? <section className="section section-partner">
      <button type="button" disabled={busy} onClick={() => { setSelected(null); setEditing(false); }}>Back to requirements</button>
      <h2>{item.code} · {item.title}</h2>
      <p>Category: {label(requirementCategoryOptions, item.category)} · Priority: {label(taskPriorityOptions, item.priority)}</p>
      <p>Progress: <strong>{progressLabels[item.progress]}</strong>{item.completed ? " ✓" : ""}</p>
      {item.attention.length > 0 && <p>Needs attention: {item.attention.map(reason => attentionLabels[reason]).join("; ")}</p>}
      <p>Owner: {item.owner_name ?? "No owner"} · Institution: {item.partner_name ?? "None"}</p>
      <p>Due date: <span className={item.due_date && !item.completed && item.due_date < today ? "requirement-overdue" : undefined}>{item.due_date ?? "None"}</span></p>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.description || "No description."}</p>
      <h3>How it is completed</h3>
      {item.mode === "manual"
        ? <p>No tasks are linked, so the coordinator checks this requirement manually.</p>
        : <p>It is checked automatically when all linked tasks are completed. {item.task_completed} of {item.task_total} active linked task{item.task_total === 1 ? "" : "s"} completed.</p>}
      {item.tasks.length > 0 && <ul>{item.tasks.map(task => <li key={task.id}>
        {task.status === "active" ? <button type="button" onClick={() => onOpenTask(task.id)}>{task.title}</button> : <>{task.title} <strong>(removed task)</strong></>}
        {task.status === "active" && <> — {label(taskProgressOptions, task.progress)}</>}
      </li>)}</ul>}
      <p>Created by {item.created_by_name} on {new Date(item.created_at).toLocaleString()}</p>
      <p>Last modified by {item.updated_by_name} on {new Date(item.updated_at).toLocaleString()}</p>
      {item.can_edit && <button type="button" disabled={busy} onClick={() => { setEditing(true); setMessage(""); setNotice(null); }}>Edit requirement</button>}{" "}
      {item.can_remove && <button type="button" disabled={busy} onClick={() => void removeRequirement(item)}>Remove requirement</button>}
    </section> : <><p>This requirement is no longer available.</p><button type="button" onClick={() => setSelected(null)}>Back to requirements</button></> : <>
      {data.can_manage && <p><button type="button" disabled={busy} onClick={() => { setCreating(true); setMessage(""); setNotice(null); }}>Add requirement</button></p>}
      {!data.can_manage && <p>Only the proposal coordinator can change requirements, and only while the proposal is editable.</p>}
      <section className="requirements-summary" aria-label="Requirement summary">
        <p><strong>{data.summary.total}</strong> Total</p>
        <p><strong>{data.summary.completed}</strong> Completed</p>
        <p><strong>{data.summary.in_progress}</strong> In progress</p>
        <p><strong>{data.summary.in_review}</strong> In review</p>
        <p><strong>{data.summary.needs_attention}</strong> Need attention</p>
      </section>
      <section className="section section-records" aria-label="Requirement filters">
        <p role="group" aria-label="Requirement views">
          <button type="button" aria-pressed={tab === "all"} onClick={() => { setTab("all"); setPage(1); }}>All requirements</button>{" "}
          <button type="button" aria-pressed={tab === "mine"} onClick={() => { setTab("mine"); setPage(1); }}>My items</button>{" "}
          <button type="button" aria-pressed={tab === "attention"} onClick={() => { setTab("attention"); setPage(1); }}>Needs attention</button>
        </p>
        <p><label>Search requirements <input type="search" value={search} onChange={changeFilter(setSearch)} /></label></p>
        <p><label>Category <select value={categoryFilter} onChange={changeFilter(setCategoryFilter)}><option value="">All categories</option>{requirementCategoryOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{" "}
        <label>Owner <select value={ownerFilter} onChange={changeFilter(setOwnerFilter)}><option value="">All owners</option>{Array.from(owners).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>{" "}
        <label>Institution <select value={partnerFilter} onChange={changeFilter(setPartnerFilter)}><option value="">All institutions</option>{Array.from(partners).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></p>
        <p><label>Priority <select value={priorityFilter} onChange={changeFilter(setPriorityFilter)}><option value="">All priorities</option>{taskPriorityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{" "}
        <label>Progress <select value={progressFilter} onChange={changeFilter(setProgressFilter)}><option value="">All progress</option>{Object.entries(progressLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label></p>
        <button type="button" onClick={clearFilters}>Clear filters</button>
      </section>
      {rows.length === 0 ? <p>{data.requirements.length === 0 ? "No requirements yet." : "No requirements match these filters."}</p> : <div className="requirements-table-scroll"><table>
        <thead><tr><th>Done</th><th>Requirement</th><th>Owner</th><th>Institution</th><th>Due date</th><th>Priority</th><th>Progress</th><th>Actions</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.id}>
          <td><input type="checkbox" checked={row.completed} disabled={busy || !row.can_complete} onChange={() => void toggle(row)} aria-label={`Completed: ${row.code} ${row.title}`} /></td>
          <td><strong>{row.title}</strong><br /><small>{row.code} · {label(requirementCategoryOptions, row.category)}</small>
            {row.attention.length > 0 && <><br /><small>{row.attention.map(reason => attentionLabels[reason]).join("; ")}</small></>}</td>
          <td>{row.owner_name ?? "—"}</td><td>{row.partner_name ?? "—"}</td>
          <td className={row.due_date && !row.completed && row.due_date < today ? "requirement-overdue" : undefined}>{row.due_date ?? "—"}</td>
          <td>{label(taskPriorityOptions, row.priority)}</td>
          <td>{progressLabels[row.progress]}{row.mode === "tasks" && <><br /><small>{row.task_completed}/{row.task_total} tasks</small></>}</td>
          <td><button type="button" disabled={busy} onClick={() => { setSelected(row.id); setMessage(""); setNotice(null); }}>Details</button></td>
        </tr>)}</tbody>
      </table></div>}
      <p role="status">Showing {rows.length ? (current - 1) * pageSize + 1 : 0}–{Math.min(current * pageSize, rows.length)} of {rows.length} requirements{rows.length !== data.summary.total ? ` (${data.summary.total} in total)` : ""}.</p>
      {pages > 1 && <p>
        <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button>{" "}
        {Array.from({ length: pages }, (_, index) => <button type="button" key={index} aria-current={index + 1 === current ? "page" : undefined} onClick={() => setPage(index + 1)}>{index + 1}</button>)}{" "}
        <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button>
      </p>}
    </>)}
  </main>;
}

function RequirementForm({ data, item, busy, onSave, onCancel }: { data: RequirementList; item?: RequirementRecord; busy: boolean; onSave: (values: object) => void; onCancel: () => void }) {
  const [ownerId, setOwnerId] = useState(item?.owner_user_id ?? "");
  const linked = new Set(item?.tasks.map(task => task.id));
  // removed tasks that are still linked stay in the list, so the coordinator can unlink them
  const removedLinks = item?.tasks.filter(task => task.status === "removed") ?? [];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      title: String(form.get("title") ?? ""), description: String(form.get("description") ?? ""),
      category: String(form.get("category") ?? ""), priority: String(form.get("priority") ?? ""),
      dueDate: String(form.get("dueDate") ?? ""), ownerUserId: ownerId, partnerId: String(form.get("partnerId") ?? ""),
      taskIds: form.getAll("taskIds").map(String),
      ...(item ? { expectedVersion: item.version } : {}),
    });
  }
  return <form onSubmit={submit}><fieldset disabled={busy}>
    <p><label>Title <input name="title" defaultValue={item?.title ?? ""} required maxLength={200} /></label></p>
    <p><label>Description <textarea name="description" defaultValue={item?.description ?? ""} maxLength={10000} /></label></p>
    <p><label>Category <select name="category" defaultValue={item?.category ?? "administrative"} required>{requirementCategoryOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></p>
    <p><label>Priority <select name="priority" defaultValue={item?.priority ?? "medium"} required>{taskPriorityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></p>
    <p><label>Due date <input name="dueDate" type="date" defaultValue={item?.due_date ?? ""} /></label></p>
    <p><label>Owner <select value={ownerId} onChange={event => setOwnerId(event.target.value)}>
      <option value="">No owner</option>
      {item?.owner_user_id && !data.owners.some(owner => owner.user_id === item.owner_user_id) && <option value={item.owner_user_id}>{item.owner_name} (inactive)</option>}
      {data.owners.map(owner => <option key={owner.user_id} value={owner.user_id}>{owner.display_name} ({owner.partner_name})</option>)}
    </select></label></p>
    {ownerId ? <p>The institution follows the owner.</p> : <p><label>Institution <select name="partnerId" defaultValue={item?.partner_id ?? ""}>
      <option value="">No institution</option>
      {data.partners.map(partner => <option key={partner.id} value={partner.id}>{partner.legal_name}</option>)}
    </select></label></p>}
    <fieldset><legend>Linked tasks</legend>
      <p>With linked tasks the requirement is completed automatically when all of them are completed. Without tasks you check it yourself.</p>
      {data.linkable_tasks.length === 0 && removedLinks.length === 0 && <p>This proposal has no tasks to link yet.</p>}
      {data.linkable_tasks.map(task => <p key={task.id}><label><input type="checkbox" name="taskIds" value={task.id} defaultChecked={linked.has(task.id)} /> {task.title} — {label(taskProgressOptions, task.progress)}</label></p>)}
      {removedLinks.map(task => <p key={task.id}><label><input type="checkbox" name="taskIds" value={task.id} defaultChecked /> {task.title} (removed task, uncheck to unlink)</label></p>)}
    </fieldset>
    <button>{item ? "Save changes" : "Add requirement"}</button>{" "}<button type="button" onClick={onCancel}>Cancel</button>
  </fieldset></form>;
}
