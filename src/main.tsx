import { useEffect, useState, type FormEvent } from "react";
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
  const [recovering, setRecovering] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    fetch("/api/auth/config").then(async (response) => {
      if (!response.ok) throw new Error("Could not connect to local sign-in.");
      const config = await response.json();
      authClient = createClient(config.url, config.key);
      const listener = authClient.auth.onAuthStateChange((event, current) => {
        if (event === "PASSWORD_RECOVERY") setRecovering(true);
        setSession(current);
      });
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
  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    const { error } = await authClient.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/` });
    setMessage(error ? error.message : "If the account exists, check your email for a password reset link.");
  }
  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    const { error } = await authClient.auth.updateUser({ password });
    if (error) { setMessage(error.message); return; }
    setRecovering(false);
    setMessage("");
  }
  if (!ready) return <main><p>Loading sign-in...</p></main>;
  if (recovering) return <main><h1>Choose a new password</h1><form onSubmit={updatePassword}><p><label>New password <input name="password" type="password" required minLength={8} /></label></p><button>Save password</button></form>{message && <p role="alert">{message}</p>}</main>;
  if (session) return <><p>Signed in as {session.user.email} <button onClick={() => authClient.auth.signOut()}>Sign out</button></p><App key={session.user.id} /></>;
  return <main><h1>Sign in to FundSyc</h1><form onSubmit={signIn}><p><label>Email <input name="email" type="email" required /></label></p><p><label>Password <input name="password" type="password" required /></label></p><button disabled={!authClient}>Sign in</button></form>{message && <p role="alert">{message}</p>}<h2>Reset password</h2><form onSubmit={resetPassword}><p><label>Email <input name="email" type="email" required /></label></p><button disabled={!authClient}>Send reset link</button></form></main>;
}

import "./sections.css";
import type { Contact, Proposal } from "./api-types";

type ExampleData = Record<string, Record<string, string | null>[]>;

const sections: [string, string][] = [
  ["users", "Users"],
  ["organizations", "Organizations"],
  ["proposals", "Proposals"],
  ["partners", "Partners"],
  ["contacts", "Contacts"],
  ["memberships", "Memberships"],
  ["responsibilities", "Responsibilities"],
  ["assignments", "Responsibility assignments"],
  ["invitations", "Invitations"],
  ["audit_events", "Audit events"],
];

function App() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState(false);
  const [exampleData, setExampleData] = useState<ExampleData | null>(null);
  const [revision, setRevision] = useState(0);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [screen, setScreen] = useState<"review" | "edit">("review");
  const [editMessage, setEditMessage] = useState("");
  const [editingSave, setEditingSave] = useState(false);
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<{ id: string; title: string; legal_name: string }[]>([]);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerMessage, setPartnerMessage] = useState("");
  const [responsibilityBusy, setResponsibilityBusy] = useState(false);
  const [responsibilityMessage, setResponsibilityMessage] = useState("");

  async function inviteOrganization(event: FormEvent<HTMLFormElement>, proposalId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    setInviteBusy(true); setInviteMessage("");
    try {
      const response = await apiFetch("/api/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), proposalId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not invite organization.");
      form.reset(); setInviteMessage("Invitation created. No email was sent; the recipient can sign in to see it."); setRevision((value) => value + 1);
    } catch (error) { setInviteMessage(error instanceof Error ? error.message : "Could not invite organization."); }
    finally { setInviteBusy(false); }
  }

  async function resolveInvitation(id: string, action: "accept" | "decline") {
    setInviteBusy(true); setInviteMessage("");
    try {
      const response = await apiFetch(`/api/invitations/${id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not resolve invitation.");
      setInviteMessage(`Invitation ${action === "accept" ? "accepted" : "declined"}.`); setRevision((value) => value + 1);
    } catch (error) { setInviteMessage(error instanceof Error ? error.message : "Could not resolve invitation."); }
    finally { setInviteBusy(false); }
  }


  async function changeContact(proposalId: string, partnerId: string, method: string, contactId?: string, data?: object, primary = false) {
    setEditingSave(true);
    setEditMessage("");
    try {
      const path = `/api/proposals/${proposalId}/partners/${partnerId}/contacts${contactId ? `/${contactId}` : ""}${primary ? "/primary" : ""}`;
      const response = await apiFetch(path, { method, headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save contact.");
      setEditingContact(null);
      setEditMessage("Contact changes saved.");
      setRevision((current) => current + 1);
      return true;
    } catch (error) {
      setEditMessage(error instanceof Error ? error.message : "Could not save contact.");
      return false;
    } finally { setEditingSave(false); }
  }

  async function submitContact(event: FormEvent<HTMLFormElement>, proposalId: string, partnerId: string, contactId?: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const saved = await changeContact(proposalId, partnerId, contactId ? "PATCH" : "POST", contactId, Object.fromEntries(new FormData(form)));
    if (saved) form.reset();
  }

  async function changeResponsibility(proposalId: string, method: string, responsibilityId?: string, partnerId?: string, data?: object) {
    setResponsibilityBusy(true);
    setResponsibilityMessage("");
    try {
      const path = `/api/proposals/${proposalId}/responsibilities${responsibilityId && partnerId ? `/${responsibilityId}/partners/${partnerId}` : ""}`;
      const response = await apiFetch(path, { method, headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save responsibility.");
      setResponsibilityMessage("Responsibility saved.");
      setRevision((current) => current + 1);
      return true;
    } catch (error) {
      setResponsibilityMessage(error instanceof Error ? error.message : "Could not save responsibility.");
      return false;
    } finally { setResponsibilityBusy(false); }
  }

  async function createResponsibility(event: FormEvent<HTMLFormElement>, proposalId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await changeResponsibility(proposalId, "POST", undefined, undefined, Object.fromEntries(new FormData(form)))) form.reset();
  }

  async function changePartner(proposalId: string, partnerId: string, body: object, membershipId?: string) {
    setPartnerBusy(true);
    setPartnerMessage("");
    try {
      const path = `/api/proposals/${proposalId}/partners/${partnerId}/${membershipId ? `memberships/${membershipId}` : "status"}`;
      const response = await apiFetch(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save changes.");
      setPartnerMessage("Changes saved.");
      setRevision((current) => current + 1);
    } catch (error) { setPartnerMessage(error instanceof Error ? error.message : "Could not save changes."); }
    finally { setPartnerBusy(false); }
  }

  async function createProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setFormError("");
    setCreated(false);
    try {
      const response = await apiFetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data)),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Could not create the proposal.");
      }
      form.reset();
      setCreated(true);
      setError(false);
      setRevision((current) => current + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create the proposal.");
    } finally {
      setSaving(false);
    }
  }
  
  // fetch proposals from the api on component mount
  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/proposals", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("could not load proposals");
        return response.json();
      })
      .then(setProposals)
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    apiFetch("/api/invitations", { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("could not load invitations"); return response.json(); })
      .then(setInvitations).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [revision]);

  const selectedProposal = proposals?.find((proposal) => proposal.id === editing);
  if (editing && screen === "review") return (
    <main>
      <h1>Review consortium</h1>
      <button type="button" onClick={() => { setEditing(null); setEditMessage(""); }}>Back to proposals</button>
      {!selectedProposal ? <p>Proposal not found.</p> : <>
        <h2>{selectedProposal.title}</h2>
        <p><strong>Status:</strong> {selectedProposal.status}</p>
        <button type="button" onClick={() => { setScreen("edit"); setEditMessage(""); }}>Edit consortium</button>
        {selectedProposal.can_manage_responsibilities && <section className="section section-invite">
          <h3>Invite an organization</h3>
          <p>The recipient can see this invitation after signing in. No email is sent yet.</p>
          <form onSubmit={(event) => inviteOrganization(event, selectedProposal.id)}>
            <p><label>Organization <input name="organization" required /></label></p>
            <p><label>Recipient email <input name="email" type="email" required /></label></p>
            <p><label>Country code <input name="countryCode" required pattern="[A-Za-z]{2}" maxLength={2} /></label></p>
            <p><label>City <input name="city" /></label></p>
            <button disabled={inviteBusy || !["draft", "in_preparation"].includes(selectedProposal.status)}>Create invitation</button>
          </form>
          {inviteMessage && <p role="status">{inviteMessage}</p>}
          <h4>Pending invitations</h4>
          {selectedProposal.pending_invitations.length === 0 ? <p>No pending invitations.</p> : <ul>{selectedProposal.pending_invitations.map((invitation) => <li key={invitation.id}>{invitation.legal_name} — {invitation.recipient_email} (expires {new Date(invitation.expires_at).toLocaleDateString()})</li>)}</ul>}
        </section>}
        <h3>Partners</h3>
        {selectedProposal.partners.length === 0 && <p>No active partners.</p>}
        {selectedProposal.partners.map((partner) => (
          <section className="section section-partner" key={partner.id}>
            <h4>{partner.legal_name}</h4>
            <p><strong>Role:</strong> {partner.id === selectedProposal.coordinator_partner_id ? "Coordinator" : "Beneficiary"}</p>
            <p><strong>Status:</strong> {partner.status}</p>
            <p><strong>Location:</strong> {[partner.city, partner.country_code].filter(Boolean).join(", ")}</p>
            <p><strong>Primary contact:</strong> {partner.full_name ? `${partner.full_name} (${partner.email})` : "Not listed"}</p>
            <p><strong>Responsibilities:</strong> {partner.responsibilities.join(", ") || "None listed"}</p>
            <p><strong>Contacts:</strong></p>
            <ul>{partner.contacts.map((contact) => <li key={contact.id}>{contact.full_name} ({contact.email}){contact.id === partner.primary_contact_id ? " — primary" : ""}{contact.job_title ? ` — ${contact.job_title}` : ""}{contact.phone ? ` — ${contact.phone}` : ""}</li>)}</ul>
          </section>
        ))}
      </>}
    </main>
  );
  if (editing) return (
    <main>
      <h1>Edit consortium</h1>
      <button type="button" onClick={() => { setScreen("review"); setEditMessage(""); }}>Back to review</button>
      {!selectedProposal ? <p>Proposal not found.</p> : <>
        <h2>{selectedProposal.title}</h2>
        <section className="section section-partner">
          <h3>Responsibilities</h3>
          <p>Create responsibilities and choose which partners are responsible for each one.</p>
          {selectedProposal.responsibilities.length === 0 && <p>No responsibilities yet.</p>}
          {selectedProposal.responsibilities.map((responsibility) => <div key={responsibility.id}>
            <h4>{responsibility.title}</h4>
            {responsibility.description && <p>{responsibility.description}</p>}
            {selectedProposal.partners.map((partner) => <p key={partner.id}><label>
              <input type="checkbox" checked={responsibility.partner_ids.includes(partner.id)} disabled={responsibilityBusy || !selectedProposal.can_manage_responsibilities || !["draft", "in_preparation"].includes(selectedProposal.status)} onChange={(event) => void changeResponsibility(selectedProposal.id, event.target.checked ? "PUT" : "DELETE", responsibility.id, partner.id)} /> {partner.legal_name}
            </label></p>)}
          </div>)}
          {selectedProposal.can_manage_responsibilities && ["draft", "in_preparation"].includes(selectedProposal.status) ? <form onSubmit={(event) => createResponsibility(event, selectedProposal.id)}>
            <h4>Add a responsibility</h4>
            <p><label>Title <input name="title" required /></label></p>
            <p><label>Description <input name="description" /></label></p>
            <button disabled={responsibilityBusy}>Create responsibility</button>
          </form> : <p>Responsibilities can be changed by the coordinator while the proposal is editable.</p>}
          {responsibilityMessage && <p role="status">{responsibilityMessage}</p>}
        </section>
        <p>Manage contacts for your organization. Adding a contact does not give them access to the proposal.</p>
        {selectedProposal.partners.map((partner) => {
          const editable = partner.can_manage_contacts && ["draft", "in_preparation"].includes(selectedProposal.status);
          const contactForm = (contact?: Contact) => (
            <form key={contact?.id ?? "new"} onSubmit={(event) => submitContact(event, selectedProposal.id, partner.id, contact?.id)}>
              <p><label>Name <input name="fullName" defaultValue={contact?.full_name ?? ""} required /></label></p>
              <p><label>Email <input name="email" type="email" defaultValue={contact?.email ?? ""} required /></label></p>
              <p><label>Job title <input name="jobTitle" defaultValue={contact?.job_title ?? ""} /></label></p>
              <p><label>Phone <input name="phone" defaultValue={contact?.phone ?? ""} /></label></p>
              <button disabled={editingSave}>{contact ? "Save contact" : "Add contact"}</button>
              {contact && <button type="button" onClick={() => setEditingContact(null)}>Cancel</button>}
            </form>
          );
          return <section className="section section-partner" key={partner.id}>
            <h3>{partner.legal_name}</h3>
            <p>{partner.id === selectedProposal.coordinator_partner_id ? "Coordinator" : "Beneficiary"} — {partner.status}</p>
            <h4>Proposal access</h4>
            {partner.members.length === 0 && <p>No members with access.</p>}
            {partner.members.map((member) => <p key={member.id}>{member.display_name} ({member.email}) — {selectedProposal.can_manage_responsibilities && partner.id !== selectedProposal.coordinator_partner_id && ["draft", "in_preparation"].includes(selectedProposal.status) ? <select aria-label={`Role for ${member.display_name}`} value={member.access_role} disabled={partnerBusy} onChange={(event) => void changePartner(selectedProposal.id, partner.id, { role: event.target.value }, member.id)}><option value="partner_admin">Partner admin</option><option value="contributor">Contributor</option><option value="viewer">Viewer</option></select> : member.access_role}</p>)}
            {["draft", "in_preparation"].includes(selectedProposal.status) && partner.id !== selectedProposal.coordinator_partner_id && <>
              {selectedProposal.can_manage_responsibilities && <button type="button" disabled={partnerBusy} onClick={() => { if (window.confirm(`Remove ${partner.legal_name}? Its members will lose proposal access.`)) void changePartner(selectedProposal.id, partner.id, { status: "removed" }); }}>Remove partner</button>}
              {partner.can_withdraw && <button type="button" disabled={partnerBusy} onClick={() => { if (window.confirm(`Withdraw ${partner.legal_name}? Its members will lose proposal access.`)) void changePartner(selectedProposal.id, partner.id, { status: "withdrawn" }); }}>Withdraw partner</button>}
            </>}
            {!partner.can_manage_contacts && <p>The demo user cannot manage this partner's contacts.</p>}
            {partner.can_manage_contacts && !editable && <p>This proposal is read-only.</p>}
            {partner.contacts.map((contact) => <div key={contact.id}>
              {editingContact === contact.id && editable ? contactForm(contact) : <>
                <p>{contact.full_name} ({contact.email}){contact.id === partner.primary_contact_id ? " — primary" : ""}{contact.job_title ? ` — ${contact.job_title}` : ""}{contact.phone ? ` — ${contact.phone}` : ""}</p>
                {editable && <p>
                  <button type="button" disabled={editingSave} onClick={() => setEditingContact(contact.id)}>Edit</button>{" "}
                  {contact.id !== partner.primary_contact_id && <><button type="button" disabled={editingSave} onClick={() => changeContact(selectedProposal.id, partner.id, "PATCH", contact.id, undefined, true)}>Make primary</button>{" "}<button type="button" disabled={editingSave} onClick={() => { if (window.confirm(`Remove ${contact.full_name} from contacts?`)) void changeContact(selectedProposal.id, partner.id, "DELETE", contact.id); }}>Remove</button></>}
                </p>}
              </>}
            </div>)}
            {editable && <><h4>Add a contact</h4>{contactForm()}</>}
          </section>;
        })}
        {selectedProposal.partners.length === 0 && <p>No active partners.</p>}
      </>}
      {editMessage && <p role="status">{editMessage}</p>}
      {partnerMessage && <p role="status">{partnerMessage}</p>}
    </main>
  );

  return (
    <main>
      <h1>FundSyc</h1>
      <section className="section section-invite">
        <h2>My invitations</h2>
        {invitations.length === 0 && <p>No pending invitations.</p>}
        {invitations.map((invitation) => <div key={invitation.id}>
          <p>{invitation.legal_name} — {invitation.title}</p>
          <button type="button" disabled={inviteBusy} onClick={() => resolveInvitation(invitation.id, "accept")}>Accept</button>{" "}
          <button type="button" disabled={inviteBusy} onClick={() => resolveInvitation(invitation.id, "decline")}>Decline</button>
        </div>)}
        {inviteMessage && <p role="status">{inviteMessage}</p>}
      </section>
      <section className="section section-create">
        <h2>Create a proposal</h2>
        <p>The seeded demo user will be the coordinator manager and primary contact.</p>
        <form onSubmit={createProposal}>
          <p><label>Proposal title <input name="title" required /></label></p>
          <p><label>Acronym <input name="acronym" /></label></p>
          <p><label>Coordinator organization <input name="organization" required /></label></p>
          <p><label>Country code <input name="countryCode" required pattern="[A-Za-z]{2}" maxLength={2} placeholder="GR" /></label></p>
          <p><label>City <input name="city" /></label></p>
          <button type="submit" disabled={saving}>{saving ? "Creating..." : "Create proposal"}</button>
        </form>
        {formError && <p role="alert">{formError}</p>}
        {created && <p role="status">Proposal created.</p>}
      </section>
      {error && <p>Could not load data. Check that the API and local database are running.</p>}
      {!error && proposals === null && <p>Loading...</p>}
      {proposals?.length === 0 && <p>No proposals found. Run the database seed to add an example.</p>}
      {proposals?.map((proposal) => (
        <section className="section section-proposal" key={proposal.id}>
          <h2>Proposal</h2>
          <p><strong>Title:</strong> {proposal.title}{proposal.acronym && ` (${proposal.acronym})`}</p>
          <p><strong>Status:</strong> {proposal.status}</p>
          <h3>Consortium</h3>
          <button type="button" onClick={() => { setScreen("review"); setEditing(proposal.id); }}>Review consortium</button>
          {proposal.partners.length === 0 ? <p>No active partners.</p> : (
            <table>
              <thead><tr><th scope="col">Organization</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Contact</th><th scope="col">Responsibility</th></tr></thead>
              <tbody>
                {proposal.partners.map((partner) => (
                  <tr key={partner.id}>
                    <td>{partner.legal_name} ({[partner.city, partner.country_code].filter(Boolean).join(", ")})</td>
                    <td>{partner.id === proposal.coordinator_partner_id ? "Coordinator" : "Beneficiary"}</td>
                    <td>{partner.status}</td>
                    <td>{partner.full_name ? `${partner.full_name} (${partner.email})` : "—"}</td>
                    <td>{partner.responsibilities.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      {exampleData && (
        <section className="section section-records">
          <h2>All database records</h2>
          {sections.map(([key, title]) => {
            const rows = exampleData[key] ?? [];
            const columns = rows.length ? Object.keys(rows[0]) : [];
            return (
              <section key={key}>
                <h3>{title}</h3>
                {rows.length === 0 ? <p>No records yet.</p> : (
                  <table>
                    <thead><tr>{columns.map((column) => <th key={column} scope="col">{column.replaceAll("_", " ")}</th>)}</tr></thead>
                    <tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{row[column] ?? "—"}</td>)}</tr>)}</tbody>
                  </table>
                )}
              </section>
            );
          })}
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Login />);
