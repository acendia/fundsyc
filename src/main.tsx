import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { SchedulePage } from "./SchedulePage";
import { TasksPage } from "./TasksPage";
import { DocumentsPage } from "./DocumentsPage";
import { DiscussionsPage } from "./DiscussionsPage";
import { MessagesPage } from "./MessagesPage";
import { RequirementsPage } from "./RequirementsPage";
import { OverviewPage } from "./OverviewPage";
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
  const [allowSignup, setAllowSignup] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    fetch("/api/auth/config").then(async (response) => {
      if (!response.ok) throw new Error("Could not connect to local sign-in.");
      const config = await response.json();
      setAllowSignup(config.allowSignup === true);
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
    if (!allowSignup) { setMessage("Account registration is disabled."); return; }
    const data = new FormData(event.currentTarget);
    const fullName = String(data.get("fullName")).trim();
    if (!fullName) { setMessage("Enter your full name."); return; }
    const { data: result, error } = await authClient.auth.signUp({ email: String(data.get("email")).trim(), password: String(data.get("password")), options: { data: { full_name: fullName } } });
    if (error) { setMessage(error.message); return; }
    if (!result.session) { setMessage("Account registration could not finish. Email confirmations must be disabled in Supabase."); return; }
    setRegistering(false); setMessage("");
  }
  if (!ready) return <main><p>Loading sign-in...</p></main>;
  if (registering && allowSignup) return <main><h1>Create an account</h1><form onSubmit={signUp}><p><label>Full name <input name="fullName" required /></label></p><p><label>Email <input name="email" type="email" required /></label></p><p><label>Password <input name="password" type="password" minLength={8} required /></label></p><button disabled={!authClient}>Create account</button></form><button type="button" onClick={() => { setRegistering(false); setMessage(""); }}>Back to sign in</button>{message && <p role="status">{message}</p>}</main>;
  if (session) return <><p>Signed in as {session.user.email} <button onClick={() => authClient.auth.signOut()}>Sign out</button></p><App key={session.user.id} /></>;
  return <main><h1>Sign in to FundSyc</h1><form onSubmit={signIn}><p><label>Email <input name="email" type="email" required /></label></p><p><label>Password <input name="password" type="password" required /></label></p><button disabled={!authClient}>Sign in</button></form>{message && <p role="alert">{message}</p>}{allowSignup && <p><button type="button" onClick={() => { setRegistering(true); setMessage(""); }}>Create an account</button></p>}</main>;
}

import "./sections.css";
import { ConsortiumPage } from "./ConsortiumPage";
import type { Proposal, OverviewPageName, OverviewTarget } from "./api-types";

type Invitation = { id: string; title: string; legal_name: string; kind: string; granted_role: string };

function App() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [itemTarget, setTarget] = useState<(OverviewTarget & { proposalId: string }) | null>(null);
  const [page, setPage] = useState<OverviewPageName | "overview">("overview");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [showInvitations, setShowInvitations] = useState(false);
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
  const noProposals = proposals?.length === 0;
  const createExpanded = !showInvitations && (showCreate || noProposals);
  const target = itemTarget?.proposalId === activeProposalId ? itemTarget : null;
  function navigate(next: OverviewPageName | "overview") { setTarget(null); setPageBusy(false); setPage(next); refresh(); }
  function openItem(next: OverviewTarget) {
    if (!activeProposal) return;
    setTarget({ ...next, proposalId: activeProposal.id }); setPageBusy(false); setPage(next.page); refresh();
  }
  return <div className="workspace">
    <aside className="workspace-sidebar">
      <h2>FundSyc</h2>
      <nav aria-label="Proposal pages">
        <button type="button" aria-current={page === "overview" ? "page" : undefined} disabled={!activeProposal || busy} onClick={() => navigate("overview")}>Overview</button>
        <button type="button" aria-current={page === "consortium" ? "page" : undefined} disabled={(!activeProposal && !noProposals) || busy} onClick={() => navigate("consortium")}>Consortium</button>
        <button type="button" aria-current={page === "documents" ? "page" : undefined} disabled={!activeProposal || busy} onClick={() => navigate("documents")}>Documents</button>
        <button type="button" aria-current={page === "tasks" ? "page" : undefined} disabled={!activeProposal || busy} onClick={() => navigate("tasks")}>Tasks</button>
        <button type="button" aria-current={page === "requirements" ? "page" : undefined} disabled={!activeProposal || busy} onClick={() => navigate("requirements")}>Requirements</button>
        <button type="button" aria-current={page === "schedule" ? "page" : undefined} disabled={!activeProposal || busy} onClick={() => navigate("schedule")}>Schedule</button>
        <button type="button" aria-current={page === "discussions" ? "page" : undefined} disabled={!activeProposal || busy} onClick={() => navigate("discussions")}>Discussions</button>
        <button type="button" aria-current={page === "messages" ? "page" : undefined} disabled={!activeProposal || busy} onClick={() => navigate("messages")}>Messages</button>
      </nav>
    </aside>
    <div className="workspace-content">
      <header className="workspace-header">
        <p><strong>Active proposal:</strong> {activeProposal?.title ?? "None selected"}</p>
        <label>Proposal <select aria-label="Active proposal" value={activeProposalId ?? ""} disabled={!proposals?.length || busy} onChange={(event) => { setPageBusy(false); setTarget(null); setPage("overview"); setActiveProposalId(event.target.value); setCreateMessage(""); refresh(); }}>
          {!proposals?.length && <option value="">No proposals</option>}
          {proposals?.map((proposal) => <option key={proposal.id} value={proposal.id}>{proposal.title}{proposal.acronym ? ` (${proposal.acronym})` : ""} — {proposal.status}</option>)}
        </select></label>
      </header>
      <div className="workspace-tools">
        {page === "consortium" ? <>
          <div className="consortium-tools" role="group" aria-label="Proposal tools">
            <button type="button" aria-expanded={createExpanded} aria-controls="create-proposal" disabled={busy || (noProposals && createExpanded)} onClick={() => { setShowCreate(!createExpanded); setShowInvitations(false); }}><span aria-hidden="true">+</span> New proposal</button>
            <button type="button" aria-expanded={showInvitations} aria-controls="my-invitations" disabled={busy} onClick={() => { setShowInvitations(value => !value); setShowCreate(false); }}>My invitations{invitations.length > 0 && <> <span className="consortium-tool-count">{invitations.length}</span></>} <span aria-hidden="true">{showInvitations ? "▴" : "▾"}</span></button>
            <button type="button" className="consortium-tools-refresh" disabled={busy} onClick={refresh}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 4v6h-6M20 10a8 8 0 1 0 .6 4" /></svg>
              Refresh
            </button>
          </div>
          <section id="my-invitations" className="consortium-personal-invitations" aria-label="My invitations" hidden={!showInvitations}>
            {invitations.length === 0 && <p>No pending invitations.</p>}
            {invitations.map((invitation) => <div key={invitation.id}><p>{invitation.legal_name} — {invitation.title}{invitation.kind === "member" ? ` (${invitation.granted_role})` : ""}</p>
              <button type="button" disabled={busy} onClick={() => resolveInvitation(invitation, "accept")}>Accept</button>{" "}<button type="button" disabled={busy} onClick={() => resolveInvitation(invitation, "decline")}>Decline</button>
            </div>)}
          </section>
        </> : (page !== "overview" || !activeProposal) && <button type="button" disabled={busy} onClick={refresh}>Refresh</button>}
        {inviteMessage && <p role="status">{inviteMessage}</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      {proposals === null && !error && <p>Loading proposals...</p>}
      {proposals?.length === 0 && <p>You do not belong to a proposal yet. Create one or accept an invitation.</p>}
      {page === "consortium" && <section id="create-proposal" className="consortium-create" aria-labelledby="create-proposal-heading" hidden={!createExpanded}>
        <header>
          <h2 id="create-proposal-heading">Create a proposal</h2>
          <p>You’ll be the proposal’s coordinator manager and primary contact.</p>
        </header>
        <form onSubmit={createProposal}>
          <fieldset disabled={busy}>
            <div className="consortium-create-fields">
              <label><span>Proposal title</span><input name="title" required /></label>
              <label><span>Acronym <small>Optional</small></span><input name="acronym" /></label>
              <label className="consortium-create-wide"><span>Coordinator organization</span><input name="organization" required /></label>
              <label><span>City <small>Optional</small></span><input name="city" /></label>
              <div>
                <label><span>Country code</span><input name="countryCode" required pattern="[A-Za-z]{2}" maxLength={2} placeholder="GR" aria-describedby="create-country-hint" /></label>
                <small id="create-country-hint">Two letters, e.g. GR for Greece.</small>
              </div>
            </div>
            <div className="consortium-create-actions">
              {createMessage && <p role="alert">{createMessage}</p>}
              <button type="submit">{saving ? "Creating…" : "Create proposal"}</button>
            </div>
          </fieldset>
        </form>
      </section>}
      {activeProposal && (page === "overview"
        ? <OverviewPage key={`overview:${activeProposal.id}`} proposalId={activeProposal.id} refreshKey={revision} apiFetch={apiFetch} onAccessLost={refresh} onOpen={openItem} />
        : page === "schedule" ? <SchedulePage initialItem={target?.page === "schedule" && target.id && target.scheduleKind ? { kind: target.scheduleKind, id: target.id } : undefined} onOpenTask={id => openItem({ page: "tasks", id })} key={`schedule:${activeProposal.id}:${target?.id ?? ""}`} proposalId={activeProposal.id} refreshKey={revision} apiFetch={apiFetch} onBusyChange={setPageBusy} onAccessLost={refresh} />
        : page === "tasks" ? <TasksPage initialTaskId={target?.page === "tasks" ? target.id : undefined} key={`tasks:${activeProposal.id}:${target?.id ?? ""}`} proposalId={activeProposal.id} refreshKey={revision} apiFetch={apiFetch} onBusyChange={setPageBusy} onAccessLost={refresh} />
        : page === "discussions" ? <DiscussionsPage initialDiscussionId={target?.page === "discussions" ? target.id : undefined} key={`discussions:${activeProposal.id}:${target?.id ?? ""}`} proposalId={activeProposal.id} refreshKey={revision} apiFetch={apiFetch} onBusyChange={setPageBusy} onAccessLost={refresh} />
        : page === "requirements" ? <RequirementsPage initialRequirementId={target?.page === "requirements" ? target.id : undefined} onOpenTask={id => openItem({ page: "tasks", id })} key={`requirements:${activeProposal.id}:${target?.id ?? ""}`} proposalId={activeProposal.id} refreshKey={revision} apiFetch={apiFetch} onBusyChange={setPageBusy} onAccessLost={refresh} />
        : page === "messages" ? <MessagesPage initialConversationId={target?.page === "messages" ? target.id : undefined} key={`messages:${activeProposal.id}:${target?.id ?? ""}`} proposalId={activeProposal.id} refreshKey={revision} apiFetch={apiFetch} onBusyChange={setPageBusy} onAccessLost={refresh} />
        : page === "documents" ? <DocumentsPage initialDocumentId={target?.page === "documents" ? target.id : undefined} key={`documents:${activeProposal.id}:${target?.id ?? ""}`} proposalId={activeProposal.id} refreshKey={revision} apiFetch={apiFetch} onBusyChange={setPageBusy} onAccessLost={refresh} />
        : <ConsortiumPage key={`consortium:${activeProposal.id}`} proposal={activeProposal} apiFetch={apiFetch} onChange={refresh} onBusyChange={setPageBusy} />)}
    </div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Login />);
