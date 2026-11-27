import { useEffect, useState, type FormEvent } from "react";
import type { ApiFetch, DiscussionLinkKind, DiscussionList, DiscussionRecord } from "./api-types";
import { Modal } from "./Modal";
import "./DiscussionsPage.css";

type Props = { initialDiscussionId?: string; proposalId: string; refreshKey: number; apiFetch: ApiFetch; onBusyChange: (busy: boolean) => void; onAccessLost: () => void };

const kindLabels: Record<DiscussionLinkKind, string> = { task: "Task", event: "Event", workstream: "Workstream", milestone: "Milestone" };
const linkGroups: { kind: DiscussionLinkKind; label: string; key: keyof DiscussionList["linkable"] }[] = [
  { kind: "task", label: "Tasks", key: "tasks" },
  { kind: "event", label: "Events", key: "events" },
  { kind: "workstream", label: "Workstreams", key: "workstreams" },
  { kind: "milestone", label: "Milestones", key: "milestones" },
];
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const dateTime = (value: string) => dateTimeFormat.format(new Date(value));
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
// newest of the discussion edit and its replies, shown as last activity
const lastActivity = (item: DiscussionRecord) => [item.updated_at, ...item.replies.map(reply => reply.updated_at)].sort().at(-1)!;

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 21l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></svg>;
}

function LinkBadge({ item }: { item: DiscussionRecord }) {
  if (!item.linked_kind) return <span className="discussions-muted">Not linked</span>;
  if (!item.linked_item) return <span className="discussions-badge" data-removed="true">Linked item removed</span>;
  return <span className="discussions-badge" data-kind={item.linked_item.kind}><strong>{kindLabels[item.linked_item.kind]}</strong> {item.linked_item.title}</span>;
}

type SortKey = "title" | "author" | "link" | "replies" | "activity";
const columns: { key: SortKey; label: string }[] = [
  { key: "title", label: "Discussion" }, { key: "author", label: "Started by" }, { key: "link", label: "Linked item" },
  { key: "replies", label: "Replies" }, { key: "activity", label: "Last activity" },
];
const text = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
// unlinked discussions sort after linked ones, removed links in between
const linkSortText = (item: DiscussionRecord) => item.linked_item ? `${kindLabels[item.linked_item.kind]} ${item.linked_item.title}` : item.linked_kind ? "\uffff" : "\uffff\uffff";
function compareDiscussions(a: DiscussionRecord, b: DiscussionRecord, key: SortKey) {
  if (key === "title") return text.compare(a.title, b.title);
  if (key === "author") return text.compare(a.created_by_name, b.created_by_name);
  if (key === "link") return text.compare(linkSortText(a), linkSortText(b));
  if (key === "replies") return a.reply_count - b.reply_count;
  return lastActivity(a).localeCompare(lastActivity(b));
}

function Person({ name, partner }: { name: string; partner: string }) {
  return <div className="discussions-person"><span aria-hidden="true">{initials(name)}</span><div>{name}<small>{partner}</small></div></div>;
}
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
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [linkFilter, setLinkFilter] = useState("");
  const [mine, setMine] = useState(false);
  // no sort until a column is clicked, the server order is used then
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
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
    if (result) { form.reset(); setShowCreate(false); setSelected(result.id); setEditing(false); setEditingReply(null); }
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
      <p><label><span>Linked item <small>Optional</small></span> <select name="link" defaultValue={linkValue(item)}>
        <option value="">None</option>
        {staleLink && <option value={linkValue(item)}>Previous {kindLabels[staleLink].toLowerCase()} (removed)</option>}
        {linkGroups.map(group => linkable[group.key].length > 0 && <optgroup key={group.kind} label={group.label}>
          {linkable[group.key].map(target => <option key={target.id} value={`${group.kind}:${target.id}`}>{target.title}</option>)}
        </optgroup>)}
      </select></label></p>
    </>;
  }
  const query = search.trim().toLowerCase();
  const filtered = data?.discussions.filter(item => (!query || item.title.toLowerCase().includes(query) || item.body.toLowerCase().includes(query))
    && (!linkFilter || (linkFilter === "none" ? !item.linked_kind : item.linked_kind === linkFilter))
    && (!mine || item.created_by_user_id === data.current_user_id)) ?? [];
  // ties keep the server order, so the list does not jump around
  const rows = sort ? filtered.map((item, index) => ({ item, index }))
    .sort((a, b) => (compareDiscussions(a.item, b.item, sort.key) * (sort.dir === "asc" ? 1 : -1)) || a.index - b.index)
    .map(row => row.item) : filtered;
  const toggleSort = (key: SortKey) => setSort(current => current?.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  const filterCount = [linkFilter, mine].filter(Boolean).length;
  function clearFilters() { setSearch(""); setLinkFilter(""); setMine(false); }
  return <main className="proposal-overview discussions-page">
    <header className="overview-heading overview-heading-row discussions-heading">
      <div>
        {selected && <button type="button" className="overview-link" disabled={busy} onClick={back}>← Back to discussions</button>}
        <h1>{discussion?.title ?? "Discussions"}</h1>
        <p>{discussion ? <>Started by {discussion.created_by_name} · {discussion.partner_name}</> : "Proposal-wide conversations, optionally linked to a task or schedule item."}</p>
      </div>
      {data && !selected && data.can_create && <button type="button" className="discussions-primary" aria-haspopup="dialog" disabled={busy} onClick={() => { setMessage(""); setShowCreate(true); }}><span aria-hidden="true">+</span> Start discussion</button>}
      {discussion && !editing && (discussion.can_edit || discussion.can_remove) && <div className="discussions-actions">
        {discussion.can_edit && <button type="button" className="discussions-button" disabled={busy} onClick={() => { setEditing(true); setEditingReply(null); setMessage(""); }}>Edit discussion</button>}
        {discussion.can_remove && <button type="button" className="discussions-button discussions-danger" disabled={busy} onClick={() => void removeDiscussion(discussion)}>Remove discussion</button>}
      </div>}
    </header>
    {message && !showCreate && <p className="discussions-feedback" role="status">{message}</p>}
    {error && <p className="discussions-feedback" role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading discussions…</p>}
    {data && <>
      {data.can_create && <Modal open={showCreate} onClose={() => { setShowCreate(false); setMessage(""); }} labelledBy="discussions-create-heading" busy={busy}>
        <section className="discussions-page discussions-modal">
          <h2 id="discussions-create-heading">Start a discussion</h2>
          {message && <p className="discussions-feedback" role="status">{message}</p>}
          <form onSubmit={createDiscussion}><fieldset className="discussions-form" disabled={busy}>
            {fields(data.linkable)}
            <div className="discussions-actions"><button className="discussions-primary">Start discussion</button><button type="button" className="discussions-button" onClick={() => { setShowCreate(false); setMessage(""); }}>Cancel</button></div>
          </fieldset></form>
        </section>
      </Modal>}
      {selected ? discussion ? <section className="discussions-panel discussions-detail">
        {editing && discussion.can_edit ? <form key={discussion.id} onSubmit={event => void updateDiscussion(event, discussion)}><fieldset className="discussions-form" disabled={busy}>
          <h2>Edit discussion</h2>
          {fields(data.linkable, discussion)}
          <div className="discussions-actions"><button className="discussions-primary">Save changes</button><button type="button" className="discussions-button" onClick={() => setEditing(false)}>Cancel</button></div>
        </fieldset></form> : <article className="discussions-post">
          <Person name={discussion.created_by_name} partner={discussion.partner_name} />
          <p className="discussions-muted">{dateTime(discussion.created_at)}{discussion.updated_at !== discussion.created_at ? ` · edited ${dateTime(discussion.updated_at)} by ${discussion.updated_by_name}` : ""}</p>
          <p className="discussions-body">{discussion.body}</p>
          <p className="discussions-link-line">Linked item: <LinkBadge item={discussion} /></p>
        </article>}
        <section className="discussions-replies" aria-labelledby="discussions-replies-heading">
          <h3 id="discussions-replies-heading">Replies <span className="discussions-count">{discussion.reply_count}</span></h3>
          {discussion.replies.length === 0 && <p className="discussions-muted">No replies yet.</p>}
          {discussion.replies.map(reply => <article className="discussions-reply" key={reply.id}>
            <div className="discussions-reply-head">
              <Person name={reply.created_by_name} partner={reply.partner_name} />
              <p className="discussions-muted">{dateTime(reply.created_at)}{reply.updated_at !== reply.created_at ? ` (edited ${dateTime(reply.updated_at)})` : ""}</p>
            </div>
            {editingReply === reply.id && reply.can_edit ? <form onSubmit={event => void updateReply(event, discussion, reply.id)}><fieldset className="discussions-form" disabled={busy}>
              <p><label>Edit reply <textarea name="body" required maxLength={10000} defaultValue={reply.body} /></label></p>
              <div className="discussions-actions"><button className="discussions-primary">Save reply</button><button type="button" className="discussions-button" onClick={() => setEditingReply(null)}>Cancel</button></div>
            </fieldset></form> : <>
              <p className="discussions-body">{reply.body}</p>
              {(reply.can_edit || reply.can_remove) && <div className="discussions-reply-actions">
                {reply.can_edit && <button type="button" className="overview-link" disabled={busy} onClick={() => { setEditingReply(reply.id); setEditing(false); setMessage(""); }}>Edit reply</button>}
                {reply.can_remove && <button type="button" className="overview-link discussions-danger" disabled={busy} onClick={() => void removeReply(discussion, reply.id)}>Remove reply</button>}
              </div>}
            </>}
          </article>)}
          {discussion.can_reply ? <form className="discussions-reply-form" onSubmit={event => void postReply(event, discussion)}><fieldset className="discussions-form" disabled={busy}>
            <p><label>Reply <textarea name="body" required maxLength={10000} placeholder="Write a reply" /></label></p>
            <div className="discussions-actions"><button className="discussions-primary">Post reply</button></div>
          </fieldset></form> : <p className="discussions-muted">You can read this discussion. Viewers cannot reply.</p>}
        </section>
      </section> : <section className="discussions-panel discussions-detail"><p>This discussion is no longer available.</p><button type="button" className="discussions-button" onClick={back}>Back to discussions</button></section> : <>
        <section className="discussions-panel" aria-labelledby="discussions-list-heading">
          <div className="discussions-panel-heading">
            <div><h2 id="discussions-list-heading">Active discussions</h2>
              <p role="status">{filtered.length}{filtered.length !== data.discussions.length ? ` of ${data.discussions.length}` : ""} {data.discussions.length === 1 ? "discussion" : "discussions"}</p></div>
            <div className="discussions-tools">
              <div className="discussions-search"><SearchIcon /><input type="search" aria-label="Search discussions" placeholder="Search discussions" value={search} onChange={event => setSearch(event.target.value)} /></div>
              <label className="discussions-select">Linked to <select value={linkFilter} onChange={event => setLinkFilter(event.target.value)}>
                <option value="">Anything</option>{linkGroups.map(group => <option key={group.kind} value={group.kind}>{group.label}</option>)}<option value="none">Not linked</option>
              </select></label>
              <label className="discussions-check"><input type="checkbox" checked={mine} onChange={event => setMine(event.target.checked)} /> Started by me</label>
              {(filterCount > 0 || query) && <button type="button" className="overview-link" onClick={clearFilters}>Clear</button>}
            </div>
          </div>
          {filtered.length === 0 ? <div className="discussions-empty">
            <p>{data.discussions.length === 0 ? "No discussions yet." : "No discussions match these filters."}</p>
            {data.discussions.length === 0 && data.can_create && <button type="button" className="overview-link" onClick={() => setShowCreate(true)}>Start the first discussion</button>}
          </div> : <div className="discussions-table-scroll" tabIndex={0} role="region" aria-label="Discussion table"><table>
            <thead><tr>{columns.map(column => {
              const active = sort?.key === column.key;
              return <th key={column.key} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                <button type="button" className="discussions-sort" data-active={active || undefined} onClick={() => toggleSort(column.key)}
                  aria-label={`Sort by ${column.label.toLowerCase()}, ${active && sort.dir === "asc" ? "descending" : "ascending"}`}>
                  {column.label}<span aria-hidden="true">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                </button>
              </th>;
            })}</tr></thead>
            <tbody>{rows.map(item => <tr key={item.id}>
              <th scope="row"><button type="button" className="discussions-title-link" disabled={busy} onClick={() => open(item.id)}>{item.title}</button>
                <small>{item.body.length > 110 ? item.body.slice(0, 110).trimEnd() + "…" : item.body}</small></th>
              <td><Person name={item.created_by_name} partner={item.partner_name} /></td>
              <td><LinkBadge item={item} /></td>
              <td><span className="discussions-count">{item.reply_count}</span></td>
              <td className="discussions-nowrap">{dateTime(lastActivity(item))}</td>
            </tr>)}</tbody>
          </table></div>}
        </section>
        <p className="discussions-muted">{data.can_create ? "Viewers can read discussions. Contributors, partner admins and the coordinator can start discussions and reply." : "You can read discussions. Viewers cannot start discussions or reply."}</p>
      </>}
    </>}
  </main>;
}
