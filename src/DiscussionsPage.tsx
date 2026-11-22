import { useEffect, useState, type FormEvent } from "react";
import type { ApiFetch, DiscussionLinkKind, DiscussionList, DiscussionRecord } from "./api-types";

type Props = { initialDiscussionId?: string; proposalId: string; refreshKey: number; apiFetch: ApiFetch; onBusyChange: (busy: boolean) => void; onAccessLost: () => void };

const kindLabels: Record<DiscussionLinkKind, string> = { task: "Task", event: "Event", workstream: "Workstream", milestone: "Milestone" };
const linkGroups: { kind: DiscussionLinkKind; label: string; key: keyof DiscussionList["linkable"] }[] = [
  { kind: "task", label: "Tasks", key: "tasks" },
  { kind: "event", label: "Events", key: "events" },
  { kind: "workstream", label: "Workstreams", key: "workstreams" },
  { kind: "milestone", label: "Milestones", key: "milestones" },
];
const dateTime = (value: string) => new Date(value).toLocaleString();
// the link select value is "kind:id", empty means no link
const linkValue = (discussion?: DiscussionRecord) => discussion?.linked_kind && discussion.linked_id ? `${discussion.linked_kind}:${discussion.linked_id}` : "";
const linkText = (discussion: DiscussionRecord) => discussion.linked_item ? `${kindLabels[discussion.linked_item.kind]}: ${discussion.linked_item.title}` : discussion.linked_kind ? "Linked item removed" : "None";
// the server reads linkKind and linkId together, an empty kind clears the link
function discussionValues(form: FormData) {
  const [linkKind = "", linkId = ""] = String(form.get("link") ?? "").split(":");
  return { title: String(form.get("title") ?? ""), body: String(form.get("body") ?? ""), linkKind, linkId };
}

export function DiscussionsPage({ initialDiscussionId, proposalId, refreshKey, apiFetch, onBusyChange, onAccessLost }: Props) {
  const [data, setData] = useState<DiscussionList | null>(null);
  const [selected, setSelected] = useState<string | null>(initialDiscussionId ?? null);
  const [editing, setEditing] = useState(false);
  const [editingReply, setEditingReply] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const path = "/api/proposals/" + proposalId + "/discussions";
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(path, { signal: controller.signal }).then(async response => {
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The Discussions API is unavailable. Restart the local app and try again.");
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setData(null);
        if (response.status === 403) onAccessLost();
        throw new Error(result.error || "Could not load discussions.");
      }
      setData(result);
      setError("");
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load discussions."); });
    return () => controller.abort();
  }, [path, revision, refreshKey, apiFetch, onAccessLost]);

  // every write goes through here, so busy state and the error handling stay the same
  async function save(method: string, url: string, success: string, values?: object): Promise<{ id: string } | null> {
    setBusy(true); setMessage("");
    try {
      const response = await apiFetch(path + url, { method, headers: values ? { "Content-Type": "application/json" } : undefined, body: values ? JSON.stringify(values) : undefined });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The Discussions API is unavailable. Restart the local app and try again.");
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 403) onAccessLost();
        // the discussion or reply may have changed or gone, reload the latest list
        if (response.status === 404 || response.status === 409) setRevision(value => value + 1);
        throw new Error(result.error || "Could not save discussion.");
      }
      setMessage(success); setRevision(value => value + 1);
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save discussion.");
      return null;
    } finally { setBusy(false); }
  }
  async function createDiscussion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await save("POST", "", "Discussion started.", discussionValues(new FormData(form)));
    if (result) { form.reset(); setSelected(result.id); setEditing(false); setEditingReply(null); }
  }
  async function updateDiscussion(event: FormEvent<HTMLFormElement>, discussion: DiscussionRecord) {
    event.preventDefault();
    const result = await save("PATCH", "/" + discussion.id, "Discussion saved.", discussionValues(new FormData(event.currentTarget)));
    if (result) setEditing(false);
  }
  async function removeDiscussion(discussion: DiscussionRecord) {
    if (!window.confirm(`Mark ${discussion.title} as removed? Its replies will be removed with it.`)) return;
    const result = await save("DELETE", "/" + discussion.id, "Discussion marked as removed.");
    if (result) { setSelected(null); setEditing(false); setEditingReply(null); }
  }
  async function postReply(event: FormEvent<HTMLFormElement>, discussion: DiscussionRecord) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await save("POST", "/" + discussion.id + "/replies", "Reply posted.", { body: String(new FormData(form).get("body") ?? "") });
    if (result) form.reset();
  }
  async function updateReply(event: FormEvent<HTMLFormElement>, discussion: DiscussionRecord, replyId: string) {
    event.preventDefault();
    const result = await save("PATCH", "/" + discussion.id + "/replies/" + replyId, "Reply saved.", { body: String(new FormData(event.currentTarget).get("body") ?? "") });
    if (result) setEditingReply(null);
  }
  async function removeReply(discussion: DiscussionRecord, replyId: string) {
    if (!window.confirm("Mark this reply as removed?")) return;
    const result = await save("DELETE", "/" + discussion.id + "/replies/" + replyId, "Reply marked as removed.");
    if (result) setEditingReply(null);
  }

  const discussion = data?.discussions.find(item => item.id === selected);
  function open(id: string) { setSelected(id); setEditing(false); setEditingReply(null); setMessage(""); }
  function back() { setSelected(null); setEditing(false); setEditingReply(null); setMessage(""); }
  function fields(linkable: DiscussionList["linkable"], item?: DiscussionRecord) {
    // a link to a removed item stays selectable, so saving an edit does not drop it
    const staleLink = item?.linked_kind && !item.linked_item ? item.linked_kind : null;
    return <>
      <p><label>Title <input name="title" required defaultValue={item?.title ?? ""} /></label></p>
      <p><label>Message <textarea name="body" required maxLength={10000} defaultValue={item?.body ?? ""} /></label></p>
      <p><label>Linked item <select name="link" defaultValue={linkValue(item)}>
        <option value="">None</option>
        {staleLink && <option value={linkValue(item)}>Previous {kindLabels[staleLink].toLowerCase()} (removed)</option>}
        {linkGroups.map(group => linkable[group.key].length > 0 && <optgroup key={group.kind} label={group.label}>
          {linkable[group.key].map(target => <option key={target.id} value={`${group.kind}:${target.id}`}>{target.title}</option>)}
        </optgroup>)}
      </select></label></p>
    </>;
  }
  return <main>
    <h1>Discussions</h1>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>Loading discussions...</p>}
    {data && <>
      <p>Viewers can read discussions. Contributors, partner admins and the coordinator can start discussions and reply.</p>
      {selected ? discussion ? <section className="section section-partner">
        <button type="button" disabled={busy} onClick={back}>Back to discussions</button>
        <h2>{discussion.title}</h2>
        {editing && discussion.can_edit ? <form key={discussion.id} onSubmit={event => void updateDiscussion(event, discussion)}><fieldset disabled={busy}>
          {fields(data.linkable, discussion)}
          <button>Save changes</button>{" "}<button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </fieldset></form> : <>
          <p>Started by {discussion.created_by_name} ({discussion.partner_name}) on {dateTime(discussion.created_at)}</p>
          <p>Last modified by {discussion.updated_by_name} on {dateTime(discussion.updated_at)}</p>
          <p>Linked item: {linkText(discussion)}</p>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{discussion.body}</p>
          {discussion.can_edit && <button type="button" disabled={busy} onClick={() => { setEditing(true); setEditingReply(null); setMessage(""); }}>Edit discussion</button>}{" "}
          {discussion.can_remove && <button type="button" disabled={busy} onClick={() => void removeDiscussion(discussion)}>Remove discussion</button>}
        </>}
        <h3>Replies ({discussion.reply_count})</h3>
        {discussion.replies.length === 0 && <p>No replies yet.</p>}
        {discussion.replies.map(reply => <article key={reply.id}>
          <p><strong>{reply.created_by_name}</strong> ({reply.partner_name}) — {dateTime(reply.created_at)}{reply.updated_at !== reply.created_at ? ` (edited ${dateTime(reply.updated_at)})` : ""}</p>
          {editingReply === reply.id && reply.can_edit ? <form onSubmit={event => void updateReply(event, discussion, reply.id)}><fieldset disabled={busy}>
            <p><label>Edit reply <textarea name="body" required maxLength={10000} defaultValue={reply.body} /></label></p>
            <button>Save reply</button>{" "}<button type="button" onClick={() => setEditingReply(null)}>Cancel</button>
          </fieldset></form> : <>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{reply.body}</p>
            {reply.can_edit && <button type="button" disabled={busy} onClick={() => { setEditingReply(reply.id); setEditing(false); setMessage(""); }}>Edit reply</button>}{" "}
            {reply.can_remove && <button type="button" disabled={busy} onClick={() => void removeReply(discussion, reply.id)}>Remove reply</button>}
          </>}
        </article>)}
        {discussion.can_reply && <form onSubmit={event => void postReply(event, discussion)}><fieldset disabled={busy}>
          <p><label>Reply <textarea name="body" required maxLength={10000} /></label></p>
          <button>Post reply</button>
        </fieldset></form>}
      </section> : <><p>This discussion is no longer available.</p><button type="button" onClick={back}>Back to discussions</button></> : <>
        <h2>Active discussions</h2>
        {data.discussions.length === 0 ? <p>No discussions yet.</p> : <table><thead><tr><th>Title</th><th>Started by</th><th>Date</th><th>Linked item</th><th>Replies</th></tr></thead><tbody>{data.discussions.map(item => <tr key={item.id}>
          <td><button type="button" disabled={busy} onClick={() => open(item.id)}>{item.title}</button></td><td>{item.created_by_name} ({item.partner_name})</td><td>{dateTime(item.created_at)}</td><td>{linkText(item)}</td><td>{item.reply_count}</td>
        </tr>)}</tbody></table>}
        {data.can_create ? <section className="section section-create"><h2>Start a discussion</h2>
          <form onSubmit={createDiscussion}><fieldset disabled={busy}>
            {fields(data.linkable)}
            <button>Start discussion</button>
          </fieldset></form>
        </section> : <p>You can read discussions. Viewers cannot start discussions or reply.</p>}
      </>}
    </>}
  </main>;
}
