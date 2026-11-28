import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { SchedulePage } from "./schedule/SchedulePage";
import { TasksPage } from "./tasks/TasksPage";
import { DocumentsPage } from "./documents/DocumentsPage";
import { DiscussionsPage } from "./discussions/DiscussionsPage";
import { MessagesPage } from "./messages/MessagesPage";
import { RequirementsPage } from "./requirements/RequirementsPage";
import { OverviewPage } from "./overview/OverviewPage";
import { Modal } from "./components/Modal";
import { ProposalSearch } from "./components/ProposalSearch";
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
  if (session) return <App key={session.user.id} account={{ email: session.user.email ?? "", onSignOut: () => void authClient.auth.signOut() }} />;
  return <main><h1>Sign in to FundSyc</h1><form onSubmit={signIn}><p><label>Email <input name="email" type="email" required /></label></p><p><label>Password <input name="password" type="password" required /></label></p><button disabled={!authClient}>Sign in</button></form>{message && <p role="alert">{message}</p>}{allowSignup && <p><button type="button" onClick={() => { setRegistering(true); setMessage(""); }}>Create an account</button></p>}</main>;
}

import "./styles/sections.css";
import { ConsortiumPage } from "./consortium/ConsortiumPage";
import type { Proposal, OverviewPageName, OverviewTarget } from "./api-types";

function RefreshIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 4v6h-6M20 10a8 8 0 1 0 .6 4" /></svg>;
}

// sidebar order follows the design, every entry is a real section
const navItems: { page: OverviewPageName | "overview"; label: string }[] = [
  { page: "overview", label: "Overview" }, { page: "requirements", label: "Requirements" }, { page: "documents", label: "Documents" },
  { page: "tasks", label: "Tasks" }, { page: "schedule", label: "Schedule" }, { page: "consortium", label: "Consortium" },
  { page: "discussions", label: "Discussions" }, { page: "messages", label: "Messages" },
];
const navIcons: Record<string, string> = {
  overview: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  requirements: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  documents: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  tasks: "M9 11l2.5 2.5L16 9M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
  schedule: "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM4 10h16M8 3v4M16 3v4",
  consortium: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6",
  discussions: "M4 5h16v11H9l-5 4Z M8 9h8M8 12h5",
  messages: "M4 6h16v12H4zM4 7l8 6 8-6",
  signout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10",
};
function NavIcon({ name }: { name: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={navIcons[name]} /></svg>;
}

// account card in the top bar, the menu holds the sign out action
function AccountMenu({ account, busy }: { account: { email: string; onSignOut: () => void }; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return <div className="account-menu" ref={ref}>
    <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="workspace-avatar" aria-hidden="true">{account.email.slice(0, 2).toUpperCase()}</span>
      <span className="account-menu-text"><small>Signed in as</small><strong>{account.email}</strong></span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 9l4-4 4 4M8 15l4 4 4-4" /></svg>
    </button>
    {open && <div className="account-menu-list" role="menu">
      <button type="button" role="menuitem" disabled={busy} onClick={() => { setOpen(false); account.onSignOut(); }}><NavIcon name="signout" /> Sign out</button>
    </div>}
  </div>;
}

type Invitation = { id: string; title: string; legal_name: string; kind: string; granted_role: string };

function App({ account }: { account: { email: string; onSignOut: () => void } }) {
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
  // on small screens the sections scroll sideways, keep the current one visible
  useEffect(() => { document.querySelector('.workspace-sidebar nav [aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [page]);
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
  const createExpanded = showCreate;
  const target = itemTarget?.proposalId === activeProposalId ? itemTarget : null;
  // same steps the old proposal select used
  function chooseProposal(id: string) { setPageBusy(false); setTarget(null); setPage("overview"); setActiveProposalId(id); setCreateMessage(""); refresh(); }
  function navigate(next: OverviewPageName | "overview") { setTarget(null); setPageBusy(false); setShowCreate(false); setPage(next); refresh(); }
  function openItem(next: OverviewTarget) {
    if (!activeProposal) return;
    setTarget({ ...next, proposalId: activeProposal.id }); setPageBusy(false); setPage(next.page); refresh();
  }
  return <div className="workspace">
    <aside className="workspace-sidebar">
      <h2 className="workspace-brand">FundSyc</h2>
      <nav aria-label="Proposal pages">
        {navItems.map(item => <button key={item.page} type="button" aria-current={page === item.page ? "page" : undefined}
          disabled={(item.page === "consortium" ? !activeProposal && !noProposals : !activeProposal) || busy} onClick={() => navigate(item.page)}>
          <NavIcon name={item.page} /><span>{item.label}</span>
        </button>)}
      </nav>
      <div className="workspace-account">
        <span className="workspace-avatar" aria-hidden="true">{account.email.slice(0, 2).toUpperCase()}</span>
        <div><small>Signed in as</small><strong title={account.email}>{account.email}</strong></div>
        <button type="button" aria-label="Sign out" title="Sign out" disabled={busy} onClick={account.onSignOut}><NavIcon name="signout" /></button>
      </div>
    </aside>
    <div className="workspace-content">
      <header className="workspace-header">
        <div className="workspace-active" title={activeProposal?.title}>
          <small>Active proposal</small>
          <strong>{activeProposal ? activeProposal.acronym || activeProposal.title : "None selected"}</strong>
          {activeProposal?.acronym && <span>{activeProposal.title}</span>}
        </div>
        <ProposalSearch proposals={proposals} activeId={activeProposalId} disabled={busy} onChoose={chooseProposal} />
        <AccountMenu account={account} busy={busy} />
      </header>
      <div className="workspace-tools">
        {page === "consortium" ? <>
          <div className="consortium-tools" role="group" aria-label="Proposal tools">
            <button type="button" aria-haspopup="dialog" disabled={busy} onClick={() => { setCreateMessage(""); setShowCreate(true); setShowInvitations(false); }}><span aria-hidden="true">+</span> New proposal</button>
            <button type="button" aria-expanded={showInvitations} aria-controls="my-invitations" disabled={busy} onClick={() => { setShowInvitations(value => !value); setShowCreate(false); }}>My invitations{invitations.length > 0 && <> <span className="consortium-tool-count">{invitations.length}</span></>} <span aria-hidden="true">{showInvitations ? "▴" : "▾"}</span></button>
            <button type="button" className="consortium-tools-refresh" disabled={busy} onClick={refresh}><RefreshIcon /> Refresh</button>
          </div>
          <section id="my-invitations" className="consortium-personal-invitations" aria-label="My invitations" hidden={!showInvitations}>
            {invitations.length === 0 && <p>No pending invitations.</p>}
            {invitations.map((invitation) => <div key={invitation.id}><p>{invitation.legal_name} — {invitation.title}{invitation.kind === "member" ? ` (${invitation.granted_role})` : ""}</p>
              <button type="button" disabled={busy} onClick={() => resolveInvitation(invitation, "accept")}>Accept</button>{" "}<button type="button" disabled={busy} onClick={() => resolveInvitation(invitation, "decline")}>Decline</button>
            </div>)}
          </section>
        </> : (page !== "overview" || !activeProposal) && <div className="consortium-tools" role="group" aria-label="Page tools">
          <button type="button" className="consortium-tools-refresh" disabled={busy} onClick={refresh}><RefreshIcon /> Refresh</button>
        </div>}
        {inviteMessage && <p role="status">{inviteMessage}</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      {proposals === null && !error && <p>Loading proposals...</p>}
      {proposals?.length === 0 && <p>You do not belong to a proposal yet. Create one or accept an invitation.</p>}
      {page === "consortium" && <Modal open={createExpanded} onClose={() => setShowCreate(false)} labelledBy="create-proposal-heading" busy={saving}>
      <section id="create-proposal" className="consortium-create" aria-labelledby="create-proposal-heading">
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
      </section>
      </Modal>}
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
