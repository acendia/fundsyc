import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { TasksPage } from "./TasksPage";
import { DocumentsPage } from "./DocumentsPage";
import { createRoot } from "react-dom/client";
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";

let authClient: SupabaseClient;
async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { data } = await authClient.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  return fetch(input, { ...init, headers });
}

function Login() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    fetch("/api/auth/config").then(async (response) => {
      if (!response.ok) throw new Error("Could not connect to local sign-in.");
      const config = await response.json();
      authClient = createClient(config.url, config.key);
      const listener = authClient.auth.onAuthStateChange((_event, current) => setSession(current));
      const { data } = await authClient.auth.getSession();
      setSession(data.session);
      unsubscribe = () => listener.data.subscription.unsubscribe();
    }).catch((error) => setMessage(error.message)).finally(() => setReady(true));
    return () => unsubscribe?.();
  }, []);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const { error } = await authClient.auth.signInWithPassword({ email: String(data.get("email")), password: String(data.get("password")) });
    setMessage(error?.message ?? "");
  }
  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fullName = String(data.get("fullName")).trim();
    if (!fullName) { setMessage("Enter your full name."); return; }
    const { data: result, error } = await authClient.auth.signUp({ email: String(data.get("email")).trim(), password: String(data.get("password")), options: { data: { full_name: fullName } } });
    if (error) { setMessage(error.message); return; }
    if (!result.session) { setMessage("Account registration could not finish. Email confirmations must be disabled in Supabase."); return; }
    setRegistering(false); setMessage("");
  }
  if (!ready) return <main><p>Loading sign-in...</p></main>;
  if (registering) return <main><h1>Create an account</h1><form onSubmit={signUp}><p><label>Full name <input name="fullName" required /></label></p><p><label>Email <input name="email" type="email" required /></label></p><p><label>Password <input name="password" type="password" minLength={8} required /></label></p><button disabled={!authClient}>Create account</button></form><button type="button" onClick={() => { setRegistering(false); setMessage(""); }}>Back to sign in</button>{message && <p role="status">{message}</p>}</main>;
  if (session) return <><p>Signed in as {session.user.email} <button onClick={() => authClient.auth.signOut()}>Sign out</button></p><App key={session.user.id} /></>;
  return <main><h1>Sign in to FundSyc</h1><form onSubmit={signIn}><p><label>Email <input name="email" type="email" required /></label></p><p><label>Password <input name="password" type="password" required /></label></p><button disabled={!authClient}>Sign in</button></form>{message && <p role="alert">{message}</p>}<p><button type="button" onClick={() => { setRegistering(true); setMessage(""); }}>Create an account</button></p></main>;
}

import "./sections.css";
import { ConsortiumPage } from "./ConsortiumPage";
import type { Proposal } from "./api-types";

type Invitation = { id: string; title: string; legal_name: string; kind: string; granted_role: string };

function App() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [page, setPage] = useState<"consortium" | "documents" | "tasks">("consortium");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [pageBusy, setPageBusy] = useState(false);
  const preferredProposal = useRef<string | null>(null);
  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const busy = pageBusy || saving || inviteBusy;

  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/proposals", { signal: controller.signal }).then(async (response) => {
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.error || "Could not load proposals.");
      if (controller.signal.aborted) return;
      setProposals(rows);
      const preferred = preferredProposal.current;
      setActiveProposalId((current) => {
        const desired = preferred ?? current;
        return rows.some((proposal: Proposal) => proposal.id === desired) ? desired : rows[0]?.id ?? null;
      });
      preferredProposal.current = null;
      setError("");
    }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    apiFetch("/api/invitations", { signal: controller.signal }).then(async (response) => {
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.error || "Could not load invitations.");
      if (!controller.signal.aborted) setInvitations(rows);
    }).catch((error) => { if (!controller.signal.aborted) setInviteMessage(error.message); });
    return () => controller.abort();
  }, [revision]);

  async function createProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true); setCreateMessage("");
    try {
      const response = await apiFetch("/api/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create proposal.");
      preferredProposal.current = result.id;
      setPage("consortium"); setPageBusy(false); setShowCreate(false); form.reset(); refresh();
    } catch (error) { setCreateMessage(error instanceof Error ? error.message : "Could not create proposal."); }
    finally { setSaving(false); }
  }
  async function resolveInvitation(invitation: Invitation, action: "accept" | "decline") {
    setInviteBusy(true); setInviteMessage("");
    try {
      const response = await apiFetch(`/api/${invitation.kind === "member" ? "member-invitations" : "invitations"}/${invitation.id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not resolve invitation.");
      setInviteMessage(`Invitation ${action === "accept" ? "accepted" : "declined"}.`); refresh();
    } catch (error) { setInviteMessage(error instanceof Error ? error.message : "Could not resolve invitation."); }
    finally { setInviteBusy(false); }
  }
  const activeProposal = proposals?.find((proposal) => proposal.id === activeProposalId);
  function navigate(next: "consortium" | "documents" | "tasks") { setPageBusy(false); setPage(next); refresh(); }
  return <div className="workspace">
    <aside className="workspace-sidebar">
      <h2>FundSyc</h2>
      <nav aria-label="Proposal pages">
        <button type="button" aria-current={page === "consortium" ? "page" : undefined} disabled={!activeProposal || busy} onClick={() => navigate("consortium")}>Consortium</button>
        <button type="button" aria-current={page === "documents" ? "page" : undefined} disabled={!activeProposal || busy} onClick={() => navigate("documents")}>Documents</button>
        <button type="button" aria-current={page === "tasks" ? "page" : undefined} disabled={!activeProposal || busy} onClick={() => navigate("tasks")}>Tasks</button>
      </nav>
    </aside>
    <div className="workspace-content">
      <header className="workspace-header">
        <p><strong>Active proposal:</strong> {activeProposal?.title ?? "None selected"}</p>
        <label>Proposal <select aria-label="Active proposal" value={activeProposalId ?? ""} disabled={!proposals?.length || busy} onChange={(event) => { setPageBusy(false); setActiveProposalId(event.target.value); setCreateMessage(""); refresh(); }}>
          {!proposals?.length && <option value="">No proposals</option>}
          {proposals?.map((proposal) => <option key={proposal.id} value={proposal.id}>{proposal.title}{proposal.acronym ? ` (${proposal.acronym})` : ""} — {proposal.status}</option>)}
        </select></label>
      </header>
      <div className="workspace-tools">
        {page === "consortium" && <button type="button" disabled={busy} onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Close new proposal" : "New proposal"}</button>}{" "}
        <button type="button" disabled={busy} onClick={refresh}>Refresh</button>
        {page === "consortium" && <details><summary>My invitations ({invitations.length})</summary>
          {invitations.length === 0 && <p>No pending invitations.</p>}
          {invitations.map((invitation) => <div key={invitation.id}><p>{invitation.legal_name} — {invitation.title}{invitation.kind === "member" ? ` (${invitation.granted_role})` : ""}</p>
            <button type="button" disabled={busy} onClick={() => resolveInvitation(invitation, "accept")}>Accept</button>{" "}<button type="button" disabled={busy} onClick={() => resolveInvitation(invitation, "decline")}>Decline</button>
          </div>)}
        </details>}
        {inviteMessage && <p role="status">{inviteMessage}</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      {proposals === null && !error && <p>Loading proposals...</p>}
      {proposals?.length === 0 && <p>You do not belong to a proposal yet. Create one or accept an invitation.</p>}
      {page === "consortium" && (showCreate || proposals?.length === 0) && <section className="section section-create">
        <h2>Create a proposal</h2><p>You will be its coordinator manager and primary contact.</p>
        <form onSubmit={createProposal}><fieldset disabled={busy}>
          <p><label>Proposal title <input name="title" required /></label></p>
          <p><label>Acronym <input name="acronym" /></label></p>
          <p><label>Coordinator organization <input name="organization" required /></label></p>
          <p><label>Country code <input name="countryCode" required pattern="[A-Za-z]{2}" maxLength={2} placeholder="GR" /></label></p>
          <p><label>City <input name="city" /></label></p><button>Create proposal</button>
        </fieldset></form>{createMessage && <p role="alert">{createMessage}</p>}
      </section>}
      {activeProposal && (page === "tasks" ? <TasksPage key={`tasks:${activeProposal.id}`} proposalId={activeProposal.id} refreshKey={revision} apiFetch={apiFetch} onBusyChange={setPageBusy} onAccessLost={refresh} /> : page === "documents" ? <DocumentsPage key={`documents:${activeProposal.id}`} proposalId={activeProposal.id} refreshKey={revision} apiFetch={apiFetch} onBusyChange={setPageBusy} onAccessLost={refresh} /> : <ConsortiumPage key={`consortium:${activeProposal.id}`} proposal={activeProposal} apiFetch={apiFetch} onChange={refresh} onBusyChange={setPageBusy} />)}
    </div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Login />);
