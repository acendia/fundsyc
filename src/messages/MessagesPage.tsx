import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiFetch, ConversationDetail, ConversationList, ConversationMember, ConversationMessage, MessagePerson } from "../api-types";
import { Modal } from "../components/Modal";
import "./MessagesPage.css";

type Props = { initialConversationId?: string; proposalId: string; refreshKey: number; apiFetch: ApiFetch; onBusyChange: (busy: boolean) => void; onAccessLost: () => void };

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const dateTime = (value: string) => dateTimeFormat.format(new Date(value));
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 21l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></svg>;
}
const unavailable = "The Messages API is unavailable. Restart the local app and try again.";

// every messaging route answers json, anything else means the api is not running
async function readJson(response: Response) {
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(unavailable);
  return response.json();
}

export function MessagesPage({ initialConversationId, proposalId, refreshKey, apiFetch, onBusyChange, onAccessLost }: Props) {
  const [list, setList] = useState<ConversationList | null>(null);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId ?? null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [threadError, setThreadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // which pop-up is open, and the chat list search
  const [dialog, setDialog] = useState<"direct" | "group" | "manage" | null>(null);
  const [chatSearch, setChatSearch] = useState("");
  // the manage pop-up belongs to one group, never carry it over to another chat
  useEffect(() => { setDialog(value => value === "manage" ? null : value); }, [selectedId]);
  const streamRef = useRef<HTMLDivElement>(null);
  // only tell the app once per lost access, otherwise a repeated 403 would refresh forever
  const lostRef = useRef(false);
  const path = "/api/proposals/" + proposalId + "/conversations";
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(path, { signal: controller.signal }).then(async response => {
      const result = await readJson(response);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setList(null);
        setDetail(null); setSelectedId(null);
        setListError(result.error || "Could not load messages.");
        // the proposal list is the place to decide what happens next
        if (response.status === 403 && !lostRef.current) { lostRef.current = true; onAccessLost(); }
        return;
      }
      lostRef.current = false;
      setList(result);
      setListError("");
    }).catch(error => {
      if (!controller.signal.aborted) {
        setList(null); setDetail(null); setSelectedId(null);
        setListError(error instanceof Error ? error.message : "Could not load messages.");
      }
    });
    return () => controller.abort();
  }, [path, revision, refreshKey, apiFetch, onAccessLost]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    const controller = new AbortController();
    apiFetch(path + "/" + selectedId, { signal: controller.signal }).then(async response => {
      const result = await readJson(response);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        // the chat is hidden or gone, so leave it and reload the list instead of retrying here
        const gone = response.status === 403 || response.status === 404;
        setDetail(null); setSelectedId(null);
        setThreadError(gone ? "This conversation is no longer available to you." : result.error || "Could not load this conversation.");
        if (gone) setRevision(value => value + 1);
        return;
      }
      setDetail(result);
      setThreadError("");
    }).catch(error => {
      if (!controller.signal.aborted) {
        setDetail(null);
        setThreadError(error instanceof Error ? error.message : "Could not load this conversation.");
      }
    });
    return () => controller.abort();
  }, [path, selectedId, revision, refreshKey, apiFetch]);

  // every write goes through here, so busy state and error handling stay the same
  async function save(method: string, url: string, success: string, values?: object): Promise<{ id: string } | null> {
    setBusy(true); setMessage("");
    try {
      const response = await apiFetch(path + url, { method, headers: values ? { "Content-Type": "application/json" } : undefined, body: values ? JSON.stringify(values) : undefined });
      const result = await readJson(response);
      if (!response.ok) {
        if ([403, 404].includes(response.status) && url) {
          setDetail(null); setSelectedId(null);
        }
        // the chat or message may have changed, so reload the latest state
        if ([403, 404, 409].includes(response.status)) setRevision(value => value + 1);
        throw new Error(result.error || "Could not save this change.");
      }
      setMessage(success); setRevision(value => value + 1);
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this change.");
      return null;
    } finally { setBusy(false); }
  }

  // newer messages arriving or a chat opening scroll the stream to the bottom
  const current = detail && detail.conversation.id === selectedId ? detail : null;
  const lastId = current?.messages.at(-1)?.id;
  useEffect(() => {
    const node = streamRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [current?.conversation.id, lastId]);

  async function startDirect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const userId = String(new FormData(form).get("userId") ?? "");
    const result = await save("POST", "", "Chat ready.", { kind: "direct", userId });
    if (result) { form.reset(); setDialog(null); setSelectedId(result.id); }
  }
  async function startGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await save("POST", "", "Group created.", { kind: "group", title: String(data.get("title") ?? ""), userIds: data.getAll("userIds").map(String) });
    if (result) { form.reset(); setDialog(null); setSelectedId(result.id); }
  }
  async function sendMessage(event: FormEvent<HTMLFormElement>, conversationId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await save("POST", "/" + conversationId + "/messages", "Message sent.", { body: String(new FormData(form).get("body") ?? "") });
    if (result) form.reset();
  }
  async function removeMessage(conversationId: string, messageId: string) {
    if (!window.confirm("Mark this message as removed? Its text will no longer be shown.")) return;
    await save("DELETE", "/" + conversationId + "/messages/" + messageId, "Message marked as removed.");
  }
  async function addMember(event: FormEvent<HTMLFormElement>, conversationId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const userId = String(new FormData(form).get("userId") ?? "");
    const result = await save("POST", "/" + conversationId + "/members", "Participant added.", { userId });
    if (result) form.reset();
  }
  async function removeMember(conversationId: string, member: ConversationMember) {
    if (!window.confirm(`Remove ${member.display_name} from this group? They will not see its history until you add them again.`)) return;
    await save("DELETE", "/" + conversationId + "/members/" + member.user_id, "Participant removed.");
  }
  async function leaveGroup(conversationId: string, title: string) {
    if (!window.confirm(`Leave ${title}? You will not see its history until the group creator adds you again.`)) return;
    const result = await save("POST", "/" + conversationId + "/leave", "You left the group.");
    if (result) { setDialog(null); setSelectedId(null); }
  }
  async function closeGroup(conversationId: string, title: string) {
    if (!window.confirm(`Close ${title}? It will be hidden from everyone and no one can send messages to it.`)) return;
    const result = await save("DELETE", "/" + conversationId, "Group closed.");
    if (result) { setDialog(null); setSelectedId(null); }
  }
  // older messages go above the loaded ones, and only when the same chat still starts with the same message
  async function loadOlder(conversation: ConversationDetail) {
    const oldest = conversation.messages[0];
    if (!oldest) return;
    setBusy(true); setMessage("");
    try {
      const response = await apiFetch(path + "/" + conversation.conversation.id + "/messages?before=" + oldest.id);
      const result = await readJson(response);
      if (!response.ok) {
        if ([403, 404].includes(response.status)) {
          setDetail(null); setSelectedId(null);
          setRevision(value => value + 1);
        }
        throw new Error(result.error || "Could not load older messages.");
      }
      setDetail(latest => latest && latest.conversation.id === conversation.conversation.id && latest.messages[0]?.id === oldest.id
        ? { ...latest, messages: [...result.messages, ...latest.messages], has_more: result.has_more }
        : latest);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load older messages.");
    } finally { setBusy(false); }
  }

  const title = current
    ? current.conversation.kind === "group"
      ? current.conversation.title ?? "Group"
      : "Chat with " + (current.members.find(member => member.user_id !== current.current_user_id)?.display_name ?? "a participant")
    : "";
  function renderPeopleOptions(people: MessagePerson[]) {
    return people.map(person => <option key={person.user_id} value={person.user_id}>{person.display_name} ({person.partner_name})</option>);
  }
  const query = chatSearch.trim().toLowerCase();
  const chats = list?.conversations.filter(conversation => !query || (conversation.title ?? "").toLowerCase().includes(query)) ?? [];
  const closeDialog = () => { setDialog(null); setMessage(""); };
  const openDialog = (next: "direct" | "group" | "manage") => { setMessage(""); setDialog(next); };
  // messages from the pop-ups show inside them, everything else above the layout
  const dialogMessage = message && dialog ? <p className="messages-feedback" role="status">{message}</p> : null;
  return <main className="proposal-overview messages-page">
    <header className="overview-heading overview-heading-row messages-heading">
      <div>
        <h1>Messages</h1>
        <p>Private chats between proposal members. Only participants can read a chat.</p>
      </div>
      {list?.can_start && <div className="messages-actions">
        <button type="button" className="messages-button" aria-haspopup="dialog" disabled={busy} onClick={() => openDialog("direct")}>New direct chat</button>
        <button type="button" className="messages-primary" aria-haspopup="dialog" disabled={busy} onClick={() => openDialog("group")}><span aria-hidden="true">+</span> New group</button>
      </div>}
    </header>
    {message && !dialog && <p className="messages-feedback" role="status">{message}</p>}
    {listError && <p className="messages-feedback" role="alert">{listError}</p>}
    {threadError && <p className="messages-feedback" role="alert">{threadError}</p>}
    {!list && !listError && <p role="status">Loading messages…</p>}
    {list && <>
      {list.can_start && <>
        <Modal open={dialog === "direct"} onClose={closeDialog} labelledBy="messages-direct-heading" busy={busy}>
          <section className="messages-page messages-modal">
            <h2 id="messages-direct-heading">New direct chat</h2>
            <p className="messages-muted">If you already have a chat with this person, it opens instead.</p>
            {dialogMessage}
            {list.people.length === 0 ? <p>No other eligible members yet.</p> : <form onSubmit={startDirect}><fieldset className="messages-form" disabled={busy}>
              <label>Member <select name="userId" required defaultValue="">
                <option value="" disabled>Choose a member</option>
                {renderPeopleOptions(list.people)}
              </select></label>
              <div className="messages-actions"><button className="messages-primary">Start chat</button><button type="button" className="messages-button" onClick={closeDialog}>Cancel</button></div>
            </fieldset></form>}
          </section>
        </Modal>
        <Modal open={dialog === "group"} onClose={closeDialog} labelledBy="messages-group-heading" busy={busy}>
          <section className="messages-page messages-modal">
            <h2 id="messages-group-heading">New group</h2>
            {dialogMessage}
            <form onSubmit={startGroup}><fieldset className="messages-form" disabled={busy}>
              <label>Group name <input name="title" required maxLength={120} /></label>
              <fieldset className="messages-people"><legend>Participants <small>You are added automatically</small></legend>
                {list.people.length === 0 && <p className="messages-muted">No other eligible members yet.</p>}
                <div>{list.people.map(person => <label key={person.user_id}><input type="checkbox" name="userIds" value={person.user_id} /> <span>{person.display_name}<small>{person.partner_name}</small></span></label>)}</div>
              </fieldset>
              <div className="messages-actions"><button className="messages-primary">Create group</button><button type="button" className="messages-button" onClick={closeDialog}>Cancel</button></div>
            </fieldset></form>
          </section>
        </Modal>
      </>}
      <div className="messages-layout">
        <section className="messages-panel messages-sidebar" aria-labelledby="messages-chats-heading">
          <div className="messages-panel-heading">
            <h2 id="messages-chats-heading">Your chats <span className="messages-count">{list.conversations.length}</span></h2>
            {list.conversations.length > 3 && <div className="messages-search"><SearchIcon /><input type="search" aria-label="Search chats" placeholder="Search chats" value={chatSearch} onChange={event => setChatSearch(event.target.value)} /></div>}
          </div>
          {list.conversations.length === 0 ? <p className="messages-empty">No chats yet.{list.can_start ? " Start a direct chat or a group." : ""}</p>
            : chats.length === 0 ? <p className="messages-empty">No chats match “{chatSearch}”.</p>
            : <ul className="messages-chats">{chats.map(conversation => <li key={conversation.id}>
              <button type="button" aria-current={conversation.id === selectedId ? "true" : undefined} disabled={busy} onClick={() => { setSelectedId(conversation.id); setMessage(""); }}>
                <span className="messages-avatar" data-kind={conversation.kind} aria-hidden="true">{conversation.kind === "group" ? "#" : initials(conversation.title ?? "?")}</span>
                <span className="messages-chat-text">
                  <strong>{conversation.title ?? (conversation.kind === "group" ? "Group" : "Chat")}</strong>
                  <small>{conversation.kind === "group" ? "Group" : "Direct chat"} · {dateTime(conversation.last_activity_at)}</small>
                </span>
              </button>
            </li>)}</ul>}
          {!list.can_start && <p className="messages-empty">You cannot start chats.</p>}
        </section>
        <section className="messages-panel messages-thread" aria-label={current ? title : "Conversation"}>
          {!current ? <div className="messages-placeholder">
            <p><strong>No chat selected</strong></p>
            <p className="messages-muted">Choose a chat on the left{list.can_start ? " or start a new one" : ""}.</p>
          </div> : <>
            <div className="messages-thread-heading">
              <div>
                <h2>{title}</h2>
                <p className="messages-muted">{current.conversation.kind === "group" ? "Group" : "Direct chat"} · {current.members.length} {current.members.length === 1 ? "participant" : "participants"}: {current.members.map(member => member.display_name).join(", ")}</p>
              </div>
              {current.conversation.kind === "group" && (current.can_manage || current.can_leave) && <div className="messages-actions">
                {current.can_manage && <button type="button" className="messages-button" aria-haspopup="dialog" disabled={busy} onClick={() => openDialog("manage")}>Manage group</button>}
                {current.can_leave && <button type="button" className="messages-button messages-danger" disabled={busy} onClick={() => void leaveGroup(current.conversation.id, title)}>Leave group</button>}
              </div>}
            </div>
            {current.can_manage && <Modal open={dialog === "manage"} onClose={closeDialog} labelledBy="messages-manage-heading" busy={busy}>
              <section className="messages-page messages-modal">
                <h2 id="messages-manage-heading">Manage {title}</h2>
                {dialogMessage}
                <h3>Participants</h3>
                {current.members.filter(member => !member.is_creator).length === 0 && <p className="messages-muted">No other participants.</p>}
                <ul className="messages-members">{current.members.filter(member => !member.is_creator).map(member => <li key={member.user_id}>
                  <span className="messages-avatar" aria-hidden="true">{initials(member.display_name)}</span>
                  <span className="messages-chat-text"><strong>{member.display_name}</strong><small>{member.partner_name ?? "No current partner"}</small></span>
                  <button type="button" className="messages-button messages-danger" disabled={busy} onClick={() => void removeMember(current.conversation.id, member)}>Remove</button>
                </li>)}</ul>
                {current.addable.length > 0 ? <form onSubmit={event => void addMember(event, current.conversation.id)}><fieldset className="messages-form messages-add-member" disabled={busy}>
                  <label>Add participant <select name="userId" required defaultValue="">
                    <option value="" disabled>Choose a member</option>
                    {renderPeopleOptions(current.addable)}
                  </select></label>
                  <button className="messages-primary">Add</button>
                </fieldset></form> : <p className="messages-muted">No other eligible members to add.</p>}
                <div className="messages-danger-zone">
                  <p className="messages-muted">Closing hides the group from everyone and stops new messages.</p>
                  <button type="button" className="messages-button messages-danger" disabled={busy} onClick={() => void closeGroup(current.conversation.id, title)}>Close group</button>
                </div>
              </section>
            </Modal>}
            <div className="messages-stream" ref={streamRef} tabIndex={0} aria-label="Messages">
              {current.has_more && <p className="messages-older"><button type="button" className="messages-button" disabled={busy} onClick={() => void loadOlder(current)}>Load older messages</button></p>}
              {current.messages.length === 0 && <p className="messages-muted messages-none">No messages yet. Say hello.</p>}
              {current.messages.map(item => <MessageRow key={item.id} message={item} busy={busy} onRemove={() => void removeMessage(current.conversation.id, item.id)} />)}
            </div>
            {current.can_send ? <form className="messages-composer" key={current.conversation.id} onSubmit={event => void sendMessage(event, current.conversation.id)}><fieldset disabled={busy}>
              <label className="messages-visually-hidden" htmlFor="messages-body">Message</label>
              <textarea id="messages-body" name="body" required maxLength={2000} rows={2} placeholder="Write a message"
                // ctrl or cmd + enter sends, plain enter keeps adding lines
                onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
              <button className="messages-primary">Send</button>
            </fieldset></form> : <p className="messages-muted messages-readonly">You can read this chat but cannot send messages.</p>}
          </>}
        </section>
      </div>
      <p className="messages-muted">Added participants can see a group's earlier messages. Viewers cannot use messaging.</p>
    </>}
  </main>;
}

function MessageRow({ message, busy, onRemove }: { message: ConversationMessage; busy: boolean; onRemove: () => void }) {
  return <article className="messages-message" data-own={message.is_own || undefined}>
    {!message.is_own && <span className="messages-avatar" aria-hidden="true">{initials(message.author_name)}</span>}
    <div className="messages-bubble">
      <p className="messages-meta"><strong>{message.is_own ? "You" : message.author_name}</strong> · {dateTime(message.created_at)}</p>
      {message.body === null
        ? <p className="messages-removed">This message was removed{message.removed_at ? ` on ${dateTime(message.removed_at)}` : ""}.</p>
        : <p className="messages-body">{message.body}</p>}
      {message.can_remove && <button type="button" className="overview-link messages-remove" disabled={busy} onClick={onRemove}>Remove</button>}
    </div>
  </article>;
}
