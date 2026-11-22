import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiFetch, ConversationDetail, ConversationList, ConversationMember, ConversationMessage, MessagePerson } from "./api-types";

type Props = { initialConversationId?: string; proposalId: string; refreshKey: number; apiFetch: ApiFetch; onBusyChange: (busy: boolean) => void; onAccessLost: () => void };

const dateTime = (value: string) => new Date(value).toLocaleString();
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
    if (result) { form.reset(); setSelectedId(result.id); }
  }
  async function startGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await save("POST", "", "Group created.", { kind: "group", title: String(data.get("title") ?? ""), userIds: data.getAll("userIds").map(String) });
    if (result) { form.reset(); setSelectedId(result.id); }
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
    if (result) setSelectedId(null);
  }
  async function closeGroup(conversationId: string, title: string) {
    if (!window.confirm(`Close ${title}? It will be hidden from everyone and no one can send messages to it.`)) return;
    const result = await save("DELETE", "/" + conversationId, "Group closed.");
    if (result) setSelectedId(null);
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
  return <main>
    <h1>Messages</h1>
    {message && <p role="status">{message}</p>}
    {listError && <p role="alert">{listError}</p>}
    {threadError && <p role="alert">{threadError}</p>}
    {!list && !listError && <p>Loading messages...</p>}
    {list && <>
      <p>Only participants can read a chat. Added participants can see its earlier messages. Viewers cannot use messaging.</p>
      <div className="messages-layout">
        <section className="section section-records">
          <h2>Your chats</h2>
          {list.conversations.length === 0 ? <p>No chats yet.</p> : <ul className="conversation-list">{list.conversations.map(conversation => <li key={conversation.id}>
            <button type="button" aria-current={conversation.id === selectedId ? "true" : undefined} disabled={busy} onClick={() => { setSelectedId(conversation.id); setMessage(""); }}>
              {conversation.kind === "group" ? conversation.title : "Chat with " + conversation.title}
            </button>
            <small>{conversation.kind === "group" ? "Group" : "Direct"}, last activity {dateTime(conversation.last_activity_at)}</small>
          </li>)}</ul>}
          {list.can_start ? <>
            <h3>Start a direct chat</h3>
            {list.people.length === 0 ? <p>No other eligible members yet.</p> : <form onSubmit={startDirect}><fieldset disabled={busy}>
              <p><label>Member <select name="userId" required defaultValue="">
                <option value="" disabled>Choose a member</option>
                {renderPeopleOptions(list.people)}
              </select></label></p>
              <button>Start direct chat</button>
            </fieldset></form>}
            <h3>Start a group</h3>
            <form onSubmit={startGroup}><fieldset disabled={busy}>
              <p><label>Group name <input name="title" required maxLength={120} /></label></p>
              <fieldset><legend>Participants (you are added automatically)</legend>
                {list.people.length === 0 && <p>No other eligible members yet.</p>}
                {list.people.map(person => <p key={person.user_id}><label><input type="checkbox" name="userIds" value={person.user_id} /> {person.display_name} ({person.partner_name})</label></p>)}
              </fieldset>
              <button>Create group</button>
            </fieldset></form>
          </> : <p>You cannot start chats.</p>}
        </section>
        <section className="section section-partner messages-thread">
          {!current ? <p>Select a chat or start a new one.</p> : <>
            <h2>{title}</h2>
            <p>Participants: {current.members.map(member => member.display_name).join(", ")}</p>
            {current.conversation.kind === "group" && (current.can_manage || current.can_leave) && <section className="group-manage">
              {current.can_manage && <>
                <h3>Manage participants</h3>
                {current.members.filter(member => !member.is_creator).length === 0 && <p>No other participants.</p>}
                <ul>{current.members.filter(member => !member.is_creator).map(member => <li key={member.user_id}>
                  {member.display_name} ({member.partner_name ?? "no current partner"}) <button type="button" disabled={busy} onClick={() => void removeMember(current.conversation.id, member)}>Remove</button>
                </li>)}</ul>
                {current.addable.length > 0 ? <form onSubmit={event => void addMember(event, current.conversation.id)}><fieldset disabled={busy}>
                  <p><label>Add participant <select name="userId" required defaultValue="">
                    <option value="" disabled>Choose a member</option>
                    {renderPeopleOptions(current.addable)}
                  </select></label> <button>Add participant</button></p>
                </fieldset></form> : <p>No other eligible members to add.</p>}
                <p><button type="button" disabled={busy} onClick={() => void closeGroup(current.conversation.id, title)}>Close group</button></p>
              </>}
              {current.can_leave && <p><button type="button" disabled={busy} onClick={() => void leaveGroup(current.conversation.id, title)}>Leave group</button></p>}
            </section>}
            <div className="message-stream" ref={streamRef} aria-label="Messages">
              {current.has_more && <p><button type="button" disabled={busy} onClick={() => void loadOlder(current)}>Load older messages</button></p>}
              {current.messages.length === 0 && <p>No messages yet.</p>}
              {current.messages.map(item => <MessageRow key={item.id} message={item} busy={busy} onRemove={() => void removeMessage(current.conversation.id, item.id)} />)}
            </div>
            {current.can_send ? <form key={current.conversation.id} onSubmit={event => void sendMessage(event, current.conversation.id)}><fieldset disabled={busy}>
              <p><label>Message <textarea name="body" required maxLength={2000} rows={3} /></label></p>
              <button>Send message</button>
            </fieldset></form> : <p>You can read this chat but cannot send messages.</p>}
          </>}
        </section>
      </div>
    </>}
  </main>;
}

function MessageRow({ message, busy, onRemove }: { message: ConversationMessage; busy: boolean; onRemove: () => void }) {
  return <article className="message">
    <p className="message-meta"><strong>{message.is_own ? "You" : message.author_name}</strong> — {dateTime(message.created_at)}</p>
    {message.body === null
      ? <p className="message-removed">This message was removed{message.removed_at ? ` on ${dateTime(message.removed_at)}` : ""}.</p>
      : <p className="message-body">{message.body}</p>}
    {message.can_remove && <button type="button" disabled={busy} onClick={onRemove}>Remove message</button>}
  </article>;
}
