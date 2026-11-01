import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
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
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoInvite, setDemoInvite] = useState<{ token: string; recipient: string } | null>(null);
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
      const response = await fetch("/api/demo/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), proposalId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not invite organization.");
      setDemoInvite(result); form.reset(); setInviteMessage("Invitation created for the demo partner. No email was sent."); setRevision((value) => value + 1);
    } catch (error) { setInviteMessage(error instanceof Error ? error.message : "Could not invite organization."); }
    finally { setInviteBusy(false); }
  }

  async function resolveInvitation(action: "accept" | "decline") {
    if (!demoInvite) return;
    setInviteBusy(true); setInviteMessage("");
    try {
      const response = await fetch("/api/demo/invitations/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: demoInvite.token, action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not resolve invitation.");
      setDemoInvite(null); setInviteMessage(`Invitation ${result.status}.`); setRevision((value) => value + 1);
    } catch (error) { setInviteMessage(error instanceof Error ? error.message : "Could not resolve invitation."); }
    finally { setInviteBusy(false); }
  }


  async function changeContact(proposalId: string, partnerId: string, method: string, contactId?: string, data?: object, primary = false) {
    setEditingSave(true);
    setEditMessage("");
    try {
      const path = `/api/proposals/${proposalId}/partners/${partnerId}/contacts${contactId ? `/${contactId}` : ""}${primary ? "/primary" : ""}`;
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
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
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
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
      const response = await fetch(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
      const response = await fetch("/api/proposals", {
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
  
  useEffect(() => {
    fetch("/api/demo/config").then((response) => response.ok ? response.json() : null).then((result) => setDemoEnabled(result?.enabled === true)).catch(() => setDemoEnabled(false));
  }, []);

  // fetch proposals from the api on component mount
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/proposals", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("could not load proposals");
        return response.json();
      })
      .then(setProposals)
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    fetch("/api/example-data", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("could not load example data");
        return response.json();
      })
      .then(setExampleData)
      .catch(() => { if (!controller.signal.aborted) setError(true); });
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
        {demoEnabled && <section className="section section-invite">
          <h3>Invite an organization</h3>
          <p>Local demo: each invitation uses a different example recipient. No email is sent.</p>
          <form onSubmit={(event) => inviteOrganization(event, selectedProposal.id)}>
            <p><label>Organization <input name="organization" required /></label></p>
            <p><label>Country code <input name="countryCode" required pattern="[A-Za-z]{2}" maxLength={2} /></label></p>
            <p><label>City <input name="city" /></label></p>
            <button disabled={inviteBusy || !["draft", "in_preparation"].includes(selectedProposal.status)}>Create invitation</button>
          </form>
          {demoInvite && <div><p>Demo inbox for {demoInvite.recipient}</p><button type="button" disabled={inviteBusy} onClick={() => resolveInvitation("accept")}>Accept</button> <button type="button" disabled={inviteBusy} onClick={() => resolveInvitation("decline")}>Decline</button></div>}
          {inviteMessage && <p role="status">{inviteMessage}</p>}
          <p>The demo inbox clears when you refresh this page.</p>
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

createRoot(document.getElementById("root")!).render(<App />);
