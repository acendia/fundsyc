import { useEffect, useState, type FormEvent } from "react";
import type { ApiFetch, TaskActivityRecord, TaskHistoryEvent, TaskHistoryPage } from "../api-types";
import { taskProgressOptions, taskPriorityOptions } from "../models";

// same date style as the rest of the tasks screen
const whenFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const when = (value: string) => whenFormat.format(new Date(value));

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
  // older history pages the user asked for, cleared whenever the activity reloads
  const [older, setOlder] = useState<TaskHistoryEvent[]>([]);
  const [moreHistory, setMoreHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
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
      setOlder([]); setMoreHistory(result.has_more_history); setHistoryError("");
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
  async function loadOlderHistory() {
    const shown = [...(activity?.history ?? []), ...older];
    const oldest = shown[shown.length - 1];
    if (!oldest) return;
    setLoadingHistory(true); setHistoryError("");
    try {
      const response = await apiFetch(`${path}/history?before=${oldest.id}`);
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 403 || response.status === 404) onAccessLost();
        throw new Error(result.error || "Could not load older task history.");
      }
      const page = result as TaskHistoryPage;
      setOlder(current => [...current, ...page.history]); setMoreHistory(page.has_more_history);
    } catch (error) { setHistoryError(error instanceof Error ? error.message : "Could not load older task history."); }
    finally { setLoadingHistory(false); }
  }
  function edit(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    void save("PATCH", String(new FormData(event.currentTarget).get("body")), id);
  }
  return <section className="tasks-activity" aria-label="Comments and task history">
    <div className="tasks-activity-column">
      <h3>Comments{activity && <span className="tasks-count">{activity.comments.filter(comment => comment.status === "active").length}</span>}</h3>
      {error && <p className="tasks-feedback" role="alert">{error}</p>}{message && <p className="tasks-feedback" role="status">{message}</p>}
      {!activity && !error && <p className="tasks-muted">Loading comments and history…</p>}
      {activity && <>
        {activity.comments.length === 0 && <p className="tasks-muted">No comments yet.</p>}
        {activity.comments.map(comment => <article className="tasks-comment" data-removed={comment.status === "removed" || undefined} key={comment.id}>
          <p className="tasks-comment-meta"><strong>{comment.author_name}</strong> · {when(comment.created_at)}{comment.updated_at !== comment.created_at && comment.status === "active" ? ` (edited ${when(comment.updated_at)})` : ""}</p>
          {comment.status === "removed" ? <p className="tasks-muted">Comment removed{comment.removed_at ? ` on ${when(comment.removed_at)}` : ""}.</p> : editing === comment.id && comment.can_edit ? <form onSubmit={event => edit(event, comment.id)}>
            <label>Edit comment <textarea name="body" defaultValue={comment.body ?? ""} required maxLength={10000} disabled={busy} /></label>
            <div className="tasks-actions"><button className="tasks-primary" disabled={busy}>Save comment</button><button type="button" className="tasks-button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button></div>
          </form> : <>
            <p className="tasks-comment-body">{comment.body}</p>
            {(comment.can_edit || comment.can_remove) && <div className="tasks-comment-actions">
              {comment.can_edit && <button type="button" className="overview-link" disabled={busy} onClick={() => setEditing(comment.id)}>Edit comment</button>}
              {comment.can_remove && <button type="button" className="overview-link tasks-danger" disabled={busy} onClick={() => { if (window.confirm("Mark this comment as removed?")) void save("DELETE", undefined, comment.id); }}>Remove comment</button>}
            </div>}
          </>}
        </article>)}
        {activity.can_comment && <form className="tasks-new-comment" onSubmit={event => { event.preventDefault(); void save("POST", draft); }}>
          <label>New comment <textarea value={draft} onChange={event => setDraft(event.target.value)} required maxLength={10000} disabled={busy} /></label>
          <div className="tasks-actions"><button className="tasks-primary" disabled={busy}>Add comment</button></div>
        </form>}
      </>}
    </div>
    {activity && <div className="tasks-activity-column">
      <h3>Task history{activity.history_total > 0 && <span className="tasks-count">{activity.history_total}</span>}</h3>
      {activity.history.length === 0 && <p className="tasks-muted">No recorded changes yet.</p>}
      <ol className="tasks-history">{[...activity.history, ...older].map(event => <li key={event.id}>
        <p><strong>{actions[event.action] ?? event.action}</strong></p>
        <p className="tasks-muted">{event.actor_name} · {when(event.created_at)}</p>
        {historyDetails(event.action, event.metadata).map((detail, index) => <p key={index} className="tasks-history-detail">{detail}</p>)}
      </li>)}</ol>
      {activity.history.length > 0 && <p className="tasks-muted" role="status">Showing {activity.history.length + older.length} of {activity.history_total} {activity.history_total === 1 ? "change" : "changes"}</p>}
      {historyError && <p className="tasks-feedback" role="alert">{historyError}</p>}
      {moreHistory && <button type="button" className="tasks-button" disabled={loadingHistory} onClick={() => void loadOlderHistory()}>{loadingHistory ? "Loading…" : "Show older history"}</button>}
    </div>}
  </section>;
}
