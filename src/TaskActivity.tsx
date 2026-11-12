import { useEffect, useState, type FormEvent } from "react";
import type { ApiFetch, TaskActivityRecord } from "./api-types";
import { taskProgressOptions, taskPriorityOptions } from "./models";

const actions: Record<string, string> = {
  "task.created": "Created task",
  "task.updated": "Updated task information",
  "task.reassigned": "Changed assignment",
  "task.progress_changed": "Changed progress",
  "task.removed": "Removed task",
  "task.comment_added": "Added a comment",
  "task.comment_edited": "Edited a comment",
  "task.comment_removed": "Removed a comment",
};

function historyDetails(action: string, metadata: Record<string, unknown>) {
  const display = (value: unknown, optionLabel = false) => {
    if (value === null) return "None";
    if (typeof value !== "string") return "";
    return optionLabel ? [...taskProgressOptions, ...taskPriorityOptions].find(option => option.value === value)?.label ?? value : value;
  };
  if (action === "task.progress_changed" && typeof metadata.before === "string" && typeof metadata.after === "string") return [`${display(metadata.before, true)} → ${display(metadata.after, true)}`];
  if (action === "task.reassigned") {
    const assignment = (value: unknown) => {
      if (!value || typeof value !== "object") return "";
      const member = value as { partner?: string; assignee?: string | null };
      return `${member.partner ?? "Previous partner"} / ${member.assignee ?? "Unassigned"}`;
    };
    return metadata.before && metadata.after ? [`${assignment(metadata.before)} → ${assignment(metadata.after)}`] : [];
  }
  const fieldNames: Record<string, string> = { title: "Title", description: "Description", priority: "Priority", due_date: "Due date", workstream: "Workstream" };
  if (action === "task.updated" && metadata.changes && typeof metadata.changes === "object") {
    return Object.entries(metadata.changes).filter(([field]) => field in fieldNames).flatMap(([field, value]) => {
      if (!value || typeof value !== "object") return [];
      const change = value as { before: unknown; after: unknown };
      return [`${fieldNames[field]}: ${display(change.before, field === "priority")} → ${display(change.after, field === "priority")}`];
    });
  }
  return [];
}

type Props = { proposalId: string; taskId: string; refreshKey: number; apiFetch: ApiFetch; busy: boolean; onBusyChange: (busy: boolean) => void; onChange: () => void; onAccessLost: () => void };

export function TaskActivity({ proposalId, taskId, refreshKey, apiFetch, busy, onBusyChange, onChange, onAccessLost }: Props) {
  const [activity, setActivity] = useState<TaskActivityRecord | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const path = `/api/proposals/${proposalId}/tasks/${taskId}`;
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`${path}/activity`, { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setActivity(null);
        if (response.status === 403 || response.status === 404) onAccessLost();
        throw new Error(result.error || "Could not load comments and history.");
      }
      setActivity(result);
      setError("");
    }).catch(error => { if (!controller.signal.aborted) { setActivity(null); setError(error.message); } });
    return () => controller.abort();
  }, [path, refreshKey, apiFetch, onAccessLost]);

  async function save(method: string, body?: string, commentId?: string) {
    onBusyChange(true);
    setMessage("");
    try {
      const response = await apiFetch(`${path}/comments${commentId ? `/${commentId}` : ""}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify({ body }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save comment.");
      setEditing(null);
      if (!commentId) setDraft("");
      setMessage(method === "DELETE" ? "Comment marked as removed." : "Comment saved.");
      onChange();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save comment."); }
    finally { onBusyChange(false); }
  }
  function edit(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    void save("PATCH", String(new FormData(event.currentTarget).get("body")), id);
  }
  return <section aria-label="Comments and task history">
    <h3>Comments</h3>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!activity && !error && <p>Loading comments and history...</p>}
    {activity && <>
      {activity.comments.length === 0 && <p>No comments yet.</p>}
      {activity.comments.map(comment => <article key={comment.id}>
        <p><strong>{comment.author_name}</strong> — {new Date(comment.created_at).toLocaleString()}{comment.updated_at !== comment.created_at && comment.status === "active" ? ` (edited ${new Date(comment.updated_at).toLocaleString()})` : ""}</p>
        {comment.status === "removed" ? <p>Comment removed{comment.removed_at ? ` on ${new Date(comment.removed_at).toLocaleString()}` : ""}.</p> : editing === comment.id && comment.can_edit ? <form onSubmit={event => edit(event, comment.id)}>
          <p><label>Edit comment <textarea name="body" defaultValue={comment.body ?? ""} required maxLength={10000} disabled={busy} /></label></p>
          <button disabled={busy}>Save comment</button>{" "}<button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
        </form> : <>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{comment.body}</p>
          {comment.can_edit && <button type="button" disabled={busy} onClick={() => setEditing(comment.id)}>Edit comment</button>}{" "}
          {comment.can_remove && <button type="button" disabled={busy} onClick={() => { if (window.confirm("Mark this comment as removed?")) void save("DELETE", undefined, comment.id); }}>Remove comment</button>}
        </>}
      </article>)}
      {activity.can_comment && <form onSubmit={event => { event.preventDefault(); void save("POST", draft); }}>
        <p><label>New comment <textarea value={draft} onChange={event => setDraft(event.target.value)} required maxLength={10000} disabled={busy} /></label></p>
        <button disabled={busy}>Add comment</button>
      </form>}
      <h3>Task history</h3>
      {activity.history.length === 0 && <p>No recorded changes yet.</p>}
      <ul>{activity.history.map(event => <li key={event.id}>
        <p>{actions[event.action] ?? event.action} — {event.actor_name} — {new Date(event.created_at).toLocaleString()}</p>
        {historyDetails(event.action, event.metadata).map((detail, index) => <p key={index} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{detail}</p>)}
      </li>)}</ul>
    </>}
  </section>;
}
