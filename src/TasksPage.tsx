import { useEffect, useState, type FormEvent } from "react";
import { taskProgressOptions, taskPriorityOptions } from "./models";
import type { ApiFetch, TaskList, TaskRecord } from "./api-types";

type Props = { proposalId: string; refreshKey: number; apiFetch: ApiFetch; onBusyChange: (busy: boolean) => void; onAccessLost: () => void };
const label = (options: readonly { value: string; label: string }[], value: string) => options.find(o => o.value === value)?.label ?? value;
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString() : "Not assigned";

export function TasksPage({ proposalId, refreshKey, apiFetch, onBusyChange, onAccessLost }: Props) {
  const [data, setData] = useState<TaskList | null>(null);
  const [view, setView] = useState<"board" | "list">("board");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
      if (!response.ok) { if (response.status === 403) setRevision(r => r + 1); throw new Error(result.error || "Could not save task."); }
      setCreating(false); setEditing(false); setSelected(method === "DELETE" ? null : result.id);
      setMessage(method === "DELETE" ? "Task marked as removed." : "Task saved."); setRevision(r => r + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save task."); }
    finally { setBusy(false); }
  }
  const task = data?.tasks.find(t => t.id === selected);
  function openTask(id: string) {
    setSelected(id);
    setEditing(false);
    setMessage("");
  }
  function back() { setSelected(null); setEditing(false); setCreating(false); setMessage(""); }
  return <main>
    <h1>Tasks</h1>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {!data && !error && <p>Loading tasks...</p>}
    {data && <>
      <p>Proposal status: {data.proposal.status}</p>
      {["submitted", "archived"].includes(data.proposal.status) && <p>This proposal is read-only.</p>}
      {creating ? <section className="section section-create"><h2>Add task</h2><TaskForm data={data} busy={busy} onSave={values => save("POST", values)} onCancel={back} /></section> : selected ? task ? <section className="section section-partner">
        <button type="button" disabled={busy} onClick={back}>Back to tasks</button><h2>{task.title}</h2>
        {editing && task.can_edit ? <TaskForm key={task.id} task={task} data={data} busy={busy} onSave={values => save("PATCH", values, task.id)} onCancel={() => setEditing(false)} /> : <>
          <p>Description: {task.description || "None"}</p><p>Progress: {label(taskProgressOptions, task.progress)}</p><p>Priority: {label(taskPriorityOptions, task.priority)}</p>
          <p>Partner: {task.partner_name}</p><p>Assignee: {task.assignee_name ?? "Unassigned"}</p>
          <p>Assigned: {dateTime(task.assigned_at)}</p><p>Due date: {task.due_date ?? "None"}</p>
          <p>Created by {task.created_by_name} on {dateTime(task.created_at)}</p><p>Last modified by {task.updated_by_name} on {dateTime(task.updated_at)}</p>
          <p>Comments: {task.comment_count}.</p>
          {task.can_edit && <button type="button" disabled={busy} onClick={() => { setEditing(true); setMessage(""); }}>Edit task</button>}{" "}
          {task.can_remove && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Mark ${task.title} as removed? Its comments will be kept.`)) void save("DELETE", undefined, task.id); }}>Remove task</button>}
        </>}
      </section> : <><p>This task is no longer available.</p><button onClick={back}>Back to tasks</button></> : <>
        <h2>Active tasks</h2>{data.can_add && <p><button type="button" disabled={busy} onClick={() => { setCreating(true); setMessage(""); }}>Add task</button></p>}
        <p role="group" aria-label="Task view">
          <button type="button" aria-pressed={view === "board"} disabled={busy} onClick={() => setView("board")}>Board</button>{" "}
          <button type="button" aria-pressed={view === "list"} disabled={busy} onClick={() => setView("list")}>List</button>
        </p>
        {view === "board" ? <div className="task-board" aria-label="Task board">
          {taskProgressOptions.map(option => {
            const tasks = data.tasks.filter(item => item.progress === option.value);
            return <section className="task-column" key={option.value} aria-labelledby={`task-column-${option.value}`}>
              <h3 id={`task-column-${option.value}`}>{option.value === "todo" ? "TODO" : option.label.toUpperCase()} ({tasks.length})</h3>
              {tasks.length === 0 && <p>No tasks.</p>}
              {tasks.map(item => <article className="task-card" key={item.id}>
                <p>Priority: <strong>{label(taskPriorityOptions, item.priority)}</strong></p>
                <h4><button type="button" disabled={busy} onClick={() => openTask(item.id)}>{item.title}</button></h4>
                {item.description && <p className="task-description">{item.description.length > 180 ? `${item.description.slice(0, 180).trimEnd()}…` : item.description}</p>}
                <p>Partner: {item.partner_name}</p>
                <p>Assignee: {item.assignee_name ?? "Unassigned"}</p>
                <p>Assigned: {dateTime(item.assigned_at)}</p>
                <p>Due date: {item.due_date ?? "None"}</p>
                <p>Comments: {item.comment_count}</p>
              </article>)}
            </section>;
          })}
        </div> : !data.tasks.length ? <p>No tasks yet.</p> : <table><thead><tr><th>Task</th><th>Progress</th><th>Priority</th><th>Partner</th><th>Assignee</th><th>Assigned</th><th>Due date</th><th>Comments</th><th>Actions</th></tr></thead><tbody>{data.tasks.map(t => <tr key={t.id}>
          <td>{t.title}</td><td>{label(taskProgressOptions, t.progress)}</td><td>{label(taskPriorityOptions, t.priority)}</td><td>{t.partner_name}</td><td>{t.assignee_name ?? "Unassigned"}</td><td>{dateTime(t.assigned_at)}</td><td>{t.due_date ?? "None"}</td><td>{t.comment_count}</td><td><button type="button" disabled={busy} onClick={() => openTask(t.id)}>Details</button></td>
        </tr>)}</tbody></table>}
      </>}
    </>}
  </main>;
}

function TaskForm({ data, task, busy, onSave, onCancel }: { data: TaskList; task?: TaskRecord; busy: boolean; onSave: (values: object) => Promise<void>; onCancel: () => void }) {
  const partners = data.partners.filter(p => p.can_create);
  const initialPartner = partners.find(p => p.members.some(m => m.user_id === data.current_user_id)) ?? partners[0];
  const [partnerId, setPartnerId] = useState(task?.partner_id ?? initialPartner?.id ?? "");
  const [assigneeId, setAssigneeId] = useState(task?.assignee_user_id ?? (task ? "" : initialPartner?.members.some(m => m.user_id === data.current_user_id) ? data.current_user_id : ""));
  const members = data.partners.find(p => p.id === partnerId)?.members ?? [];
  const canAssign = task ? task.can_assign : data.can_assign_new;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSave({ ...Object.fromEntries(new FormData(event.currentTarget)), partnerId, assigneeUserId: assigneeId || null });
  }
  return <form onSubmit={submit}><fieldset disabled={busy}>
    <p><label>Title <input name="title" defaultValue={task?.title ?? ""} required /></label></p>
    <p><label>Description <textarea name="description" defaultValue={task?.description ?? ""} /></label></p>
    <p><label>Progress <select name="progress" defaultValue={task?.progress ?? "todo"}>{taskProgressOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label></p>
    <p><label>Priority <select name="priority" defaultValue={task?.priority ?? "medium"}>{taskPriorityOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label></p>
    <p><label>Partner <select value={partnerId} disabled={!canAssign} required onChange={event => { setPartnerId(event.target.value); setAssigneeId(""); }}>
      {!partners.some(p => p.id === partnerId) && task && <option value={task.partner_id}>{task.partner_name} (previous partner)</option>}
      {partners.map(p => <option key={p.id} value={p.id}>{p.legal_name}</option>)}
    </select></label></p>
    <p><label>Assignee <select value={assigneeId} disabled={!canAssign} onChange={event => setAssigneeId(event.target.value)}>
      <option value="">Unassigned</option>
      {assigneeId && !members.some(m => m.user_id === assigneeId) && <option value={assigneeId}>{task?.assignee_name ?? "Previous assignee"} (inactive)</option>}
      {members.map(m => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
    </select></label></p>
    <p><label>Due date <input name="dueDate" type="date" defaultValue={task?.due_date ?? ""} /></label></p>
    <button>{task ? "Save changes" : "Create task"}</button>{" "}<button type="button" onClick={onCancel}>Cancel</button>
  </fieldset></form>;
}
