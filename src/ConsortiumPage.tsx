import { useEffect, useState, type FormEvent } from "react";
import type { ApiFetch, Contact, Proposal } from "./api-types";

type Props = { proposal: Proposal; apiFetch: ApiFetch; onChange: () => void; onBusyChange: (busy: boolean) => void };

export function ConsortiumPage({ proposal: selectedProposal, apiFetch, onChange, onBusyChange }: Props) {
  const [screen, setScreen] = useState<"review" | "edit">("review");
  const [editMessage, setEditMessage] = useState("");
  const [editingSave, setEditingSave] = useState(false);
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerMessage, setPartnerMessage] = useState("");
  const [responsibilityBusy, setResponsibilityBusy] = useState(false);
  const [editingResponsibility, setEditingResponsibility] = useState<string | null>(null);
  const [responsibilityMessage, setResponsibilityMessage] = useState("");
  useEffect(() => { onBusyChange(editingSave || inviteBusy || partnerBusy || responsibilityBusy); }, [editingSave, inviteBusy, partnerBusy, responsibilityBusy, onBusyChange]);
  async function inviteOrganization(event: FormEvent<HTMLFormElement>, proposalId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    setInviteBusy(true); setInviteMessage("");
    try {
      const response = await apiFetch("/api/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), proposalId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not invite organization.");
      form.reset(); setInviteMessage("Invitation created. The recipient can sign in to see it."); onChange();
    } catch (error) { setInviteMessage(error instanceof Error ? error.message : "Could not invite organization."); }
    finally { setInviteBusy(false); }
  }

  async function inviteColleague(event: FormEvent<HTMLFormElement>, proposalId: string, partnerId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    setInviteBusy(true); setEditMessage("");
    try {
      const response = await apiFetch(`/api/proposals/${proposalId}/partners/${partnerId}/member-invitations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not invite colleague.");
      form.reset(); onChange(); setEditMessage("Invitation created. The colleague can see it after signing in.");
    } catch (error) { setEditMessage(error instanceof Error ? error.message : "Could not invite colleague."); }
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
      onChange();
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
      const path = `/api/proposals/${proposalId}/responsibilities${responsibilityId ? `/${responsibilityId}${partnerId ? `/partners/${partnerId}` : ""}` : ""}`;
      const response = await apiFetch(path, { method, headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The API did not recognize this action. Restart the app and try again.");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save responsibility.");
      setResponsibilityMessage("Responsibility saved.");
      onChange();
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
      onChange();
    } catch (error) { setPartnerMessage(error instanceof Error ? error.message : "Could not save changes."); }
    finally { setPartnerBusy(false); }
  }

  if (screen === "review") return (
    <main>
      <h1>Review consortium</h1>
      {!selectedProposal ? <p>Proposal not found.</p> : <>
        <h2>{selectedProposal.title}</h2>
        <p><strong>Status:</strong> {selectedProposal.status}</p>
        <button type="button" onClick={() => { setScreen("edit"); setEditMessage(""); }}>Edit consortium</button>
        {selectedProposal.can_manage_responsibilities && <section className="section section-invite">
          <h3>Invite an organization</h3>
          <p>The recipient can see this invitation after signing in. </p>
          <form onSubmit={(event) => inviteOrganization(event, selectedProposal.id)}>
            <p><label>Organization <input name="organization" required /></label></p>
            <p><label>Recipient email <input name="email" type="email" required /></label></p>
            <p><label>Country code <input name="countryCode" required pattern="[A-Za-z]{2}" maxLength={2} /></label></p>
            <p><label>City <input name="city" /></label></p>
            <button disabled={inviteBusy || !["draft", "in_preparation"].includes(selectedProposal.status)}>Create invitation</button>
          </form>
          {inviteMessage && <p role="status">{inviteMessage}</p>}

        </section>}
        <section className="section section-invite">
          <h3>Pending invitations</h3>
          <button type="button" onClick={() => onChange()}>Refresh invitations</button>
          {selectedProposal.pending_invitations.length === 0 ? <p>No pending invitations to manage.</p> : <ul>{selectedProposal.pending_invitations.map((invitation) => <li key={invitation.id}>{invitation.legal_name} — {invitation.recipient_email} — {invitation.kind === "member" ? `Colleague (${invitation.granted_role})` : "Organization"} (expires {new Date(invitation.expires_at).toLocaleDateString()})</li>)}</ul>}
        </section>
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
  return (
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
            {editingResponsibility === responsibility.id ? <form onSubmit={async (event) => {
              event.preventDefault();
              const data = Object.fromEntries(new FormData(event.currentTarget));
              if (await changeResponsibility(selectedProposal.id, "PATCH", responsibility.id, undefined, data)) setEditingResponsibility(null);
            }}>
              <p><label>Title <input name="title" defaultValue={responsibility.title} required /></label></p>
              <p><label>Description <input name="description" defaultValue={responsibility.description ?? ""} /></label></p>
              <button disabled={responsibilityBusy}>Save</button>{" "}<button type="button" onClick={() => setEditingResponsibility(null)}>Cancel</button>
            </form> : <><h4>{responsibility.title}</h4>
              {responsibility.description && <p>{responsibility.description}</p>}
              {selectedProposal.can_manage_responsibilities && ["draft", "in_preparation"].includes(selectedProposal.status) && <p>
                <button type="button" disabled={responsibilityBusy} onClick={() => setEditingResponsibility(responsibility.id)}>Edit</button>{" "}
                <button type="button" disabled={responsibilityBusy} onClick={() => { if (window.confirm(`Remove ${responsibility.title}? It and its assignments will be marked as removed.`)) void changeResponsibility(selectedProposal.id, "DELETE", responsibility.id); }}>Remove</button>
              </p>}
            </>}
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
            {editable && <form onSubmit={(event) => inviteColleague(event, selectedProposal.id, partner.id)}>
              <h4>Invite a colleague</h4>
              <p><label>Email <input name="email" type="email" required /></label></p>
              <p><label>Role <select name="role" defaultValue="viewer"><option value="viewer">Viewer</option><option value="contributor">Contributor</option><option value="partner_admin">Partner admin</option></select></label></p>
              <button disabled={inviteBusy}>Invite colleague</button>
            </form>}
            {(editable || selectedProposal.can_manage_responsibilities) && <>
              <h4>Pending colleague invitations</h4>
              {selectedProposal.pending_invitations.filter((invitation) => invitation.kind === "member" && invitation.partner_id === partner.id).length === 0 && <p>No pending colleague invitations.</p>}
              <ul>{selectedProposal.pending_invitations.filter((invitation) => invitation.kind === "member" && invitation.partner_id === partner.id).map((invitation) => <li key={invitation.id}>{invitation.recipient_email} — {invitation.granted_role} (expires {new Date(invitation.expires_at).toLocaleDateString()})</li>)}</ul>
            </>}
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

}
