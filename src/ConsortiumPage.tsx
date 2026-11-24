import { useEffect, useState, type FormEvent } from "react";
import type { ApiFetch, Contact, Proposal } from "./api-types";
import { Modal } from "./Modal";

type Props = { proposal: Proposal; apiFetch: ApiFetch; onChange: () => void; onBusyChange: (busy: boolean) => void };
type PartnerFeedback = { partnerId: string; text: string };

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function ConsortiumPage({ proposal: selectedProposal, apiFetch, onChange, onBusyChange }: Props) {
  const [screen, setScreen] = useState<"review" | "edit">("review");
  const [showInvite, setShowInvite] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<PartnerFeedback | null>(null);
  const [editingSave, setEditingSave] = useState(false);
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [partnerBusy, setPartnerBusy] = useState(false);
  const [partnerMessage, setPartnerMessage] = useState<PartnerFeedback | null>(null);
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
      form.reset(); setShowInvite(false); setInviteMessage("Invitation created. The recipient can sign in to see it."); onChange();
    } catch (error) { setInviteMessage(error instanceof Error ? error.message : "Could not invite organization."); }
    finally { setInviteBusy(false); }
  }

  async function inviteColleague(event: FormEvent<HTMLFormElement>, proposalId: string, partnerId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    setInviteBusy(true); setEditMessage(null);
    try {
      const response = await apiFetch(`/api/proposals/${proposalId}/partners/${partnerId}/member-invitations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not invite colleague.");
      form.reset(); onChange(); setEditMessage({ partnerId, text: "Invitation created. The colleague can see it after signing in." });
    } catch (error) { setEditMessage({ partnerId, text: error instanceof Error ? error.message : "Could not invite colleague." }); }
    finally { setInviteBusy(false); }
  }

  async function changeContact(proposalId: string, partnerId: string, method: string, contactId?: string, data?: object, primary = false) {
    setEditingSave(true);
    setEditMessage(null);
    try {
      const path = `/api/proposals/${proposalId}/partners/${partnerId}/contacts${contactId ? `/${contactId}` : ""}${primary ? "/primary" : ""}`;
      const response = await apiFetch(path, { method, headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save contact.");
      setEditingContact(null);
      setEditMessage({ partnerId, text: "Contact changes saved." });
      onChange();
      return true;
    } catch (error) {
      setEditMessage({ partnerId, text: error instanceof Error ? error.message : "Could not save contact." });
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
    setPartnerMessage(null);
    try {
      const path = `/api/proposals/${proposalId}/partners/${partnerId}/${membershipId ? `memberships/${membershipId}` : "status"}`;
      const response = await apiFetch(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save changes.");
      setPartnerMessage({ partnerId, text: "Changes saved." });
      onChange();
    } catch (error) { setPartnerMessage({ partnerId, text: error instanceof Error ? error.message : "Could not save changes." }); }
    finally { setPartnerBusy(false); }
  }

  const editableProposal = ["draft", "in_preparation"].includes(selectedProposal.status);
  const canManageResponsibilities = editableProposal && selectedProposal.can_manage_responsibilities;
  const invitations = selectedProposal.pending_invitations;
  const activePartners = selectedProposal.partners.filter(partner => partner.status === "active").length;
  const roleOf = (id: string) => id === selectedProposal.coordinator_partner_id ? "Coordinator" : "Beneficiary";
  const term = search.trim().toLowerCase();
  const visiblePartners = selectedProposal.partners.filter(partner =>
    (!roleFilter || roleOf(partner.id) === roleFilter) && (!statusFilter || partner.status === statusFilter)
    && (!term || [partner.legal_name, partner.full_name, partner.email, ...partner.contacts.flatMap(contact => [contact.full_name, contact.email])]
      .some(value => value?.toLowerCase().includes(term))));
  const canEditConsortium = editableProposal && (selectedProposal.can_manage_responsibilities || selectedProposal.partners.some(partner => partner.can_manage_contacts || partner.can_withdraw));
  function openEdit() { setScreen("edit"); setEditMessage(null); }

  if (screen === "review") return (
    <main className="proposal-overview consortium-page">
      <header className="overview-heading overview-heading-row consortium-heading">
        <div>
          <p className="overview-eyebrow">Proposal{selectedProposal.acronym ? ` / ${selectedProposal.acronym}` : ""}</p>
          <h1>Consortium</h1><p>Manage proposal partners, contacts and responsibilities.</p>
        </div>
        {canManageResponsibilities && <button type="button" className="consortium-primary" aria-haspopup="dialog" disabled={inviteBusy} onClick={() => { setInviteMessage(""); setShowInvite(true); }}>+ Invite organization</button>}
      </header>
      <section className="consortium-summary" aria-label="Consortium summary">
        <div className="overview-panel consortium-metric">
          <div><strong>{selectedProposal.partners.length}</strong><p className="consortium-metric-label">Partners</p></div>
          <small>{activePartners} active</small>
        </div>
        <div className="overview-panel consortium-metric">
          <div><strong>{invitations.length}</strong><p className="consortium-metric-label">Pending invitations</p></div>
          <a href="#consortium-invitations">Review invitations below</a>
        </div>
      </section>
      {inviteMessage && !showInvite && <p className="consortium-invite-feedback" role="status">{inviteMessage}</p>}
      {canManageResponsibilities && <Modal open={showInvite} onClose={() => setShowInvite(false)} labelledBy="consortium-invite-heading" busy={inviteBusy}>
        <section id="consortium-invite">
          <h3 id="consortium-invite-heading">Invite an organization</h3>
          <p>The recipient can see this invitation after signing in.</p>
          <form className="consortium-invite-form" onSubmit={(event) => inviteOrganization(event, selectedProposal.id)}>
            <p><label>Organization <input name="organization" required /></label></p>
            <p><label>Recipient email <input name="email" type="email" required /></label></p>
            <p><label>Country code <input name="countryCode" required pattern="[A-Za-z]{2}" maxLength={2} /></label></p>
            <p><label>City <input name="city" /></label></p>
            <button className="consortium-primary" disabled={inviteBusy}>Create invitation</button>
          </form>
          {inviteMessage && <p role="status">{inviteMessage}</p>}
        </section>
      </Modal>}
      <section className="overview-panel consortium-table-panel" aria-labelledby="consortium-partners-heading">
        <div className="overview-panel-heading"><h2 id="consortium-partners-heading">Partners</h2><button type="button" className="overview-link" onClick={openEdit}>{canEditConsortium ? "Edit consortium" : "View consortium details"} →</button></div>
        <p>Organizations involved in this proposal.</p>
        <div className="consortium-filters">
          <div className="consortium-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 5 5" /></svg>
            <input type="search" aria-label="Search organizations or contacts" placeholder="Search organizations or contacts" value={search} onChange={event => setSearch(event.target.value)} />
          </div>
          <select aria-label="Filter by role" value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="">All roles</option><option>Coordinator</option><option>Beneficiary</option></select>
          <select aria-label="Filter by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">All statuses</option>{[...new Set(selectedProposal.partners.map(partner => partner.status))].sort().map(status => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select>
        </div>
        {visiblePartners.length ? <div className="consortium-table-scroll"><table>
          <thead><tr>{["Organization", "Role", "Primary contact", "Responsibilities", "Status", "Details"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          {visiblePartners.map(partner => <tbody key={partner.id}>
            <tr className="consortium-partner-row" data-expanded={expanded === partner.id}>
              <th scope="row"><div className="consortium-identity"><span className="consortium-initials" aria-hidden="true">{partner.legal_name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase()}</span><div>{partner.legal_name}<small>{[partner.city, partner.country_code].filter(Boolean).join(", ")}</small></div></div></th>
              <td><span className={partner.id === selectedProposal.coordinator_partner_id ? "consortium-coordinator" : undefined}>{roleOf(partner.id)}</span></td>
              <td>{partner.full_name ?? "Not listed"}{partner.email && <small>{partner.email}</small>}</td>
              <td>{partner.responsibilities[0] ?? "None listed"}{partner.responsibilities.length > 1 && <small>+{partner.responsibilities.length - 1} more</small>}</td>
              <td><span className="consortium-status" data-status={partner.status}>{partner.status}</span></td>
              <td><button type="button" className="consortium-details-button" aria-label={`${expanded === partner.id ? "Hide" : "Show"} details for ${partner.legal_name}`} aria-expanded={expanded === partner.id} onClick={() => setExpanded(value => value === partner.id ? null : partner.id)}>{expanded === partner.id ? "Hide" : "View"} <span aria-hidden="true">{expanded === partner.id ? "▾" : "›"}</span></button></td>
            </tr>
            {expanded === partner.id && <tr className="consortium-partner-details"><td colSpan={6}>
              <div className="consortium-detail-grid"><div><strong>Contacts</strong>
              {partner.contacts.length ? <ul>{partner.contacts.map(contact => <li key={contact.id}>{contact.full_name} ({contact.email}){contact.id === partner.primary_contact_id ? " — primary" : ""}{contact.job_title ? ` — ${contact.job_title}` : ""}{contact.phone ? ` — ${contact.phone}` : ""}</li>)}</ul> : <p>No contacts listed.</p>}
              </div><div><strong>Responsibilities</strong>
              {partner.responsibilities.length ? <ul>{partner.responsibilities.map((name, index) => <li key={index}>{name}</li>)}</ul> : <p>None listed.</p>}
              </div></div>
            </td></tr>}
          </tbody>)}
        </table></div> : <p>{selectedProposal.partners.length ? "No partners match these filters." : "No partners listed."}</p>}
        <p className="consortium-table-footer" role="status">Showing {visiblePartners.length} of {selectedProposal.partners.length} partners</p>
      </section>
      <section className="overview-panel consortium-table-panel" id="consortium-invitations" aria-labelledby="consortium-invitations-heading">
        <div className="overview-panel-heading"><h2 id="consortium-invitations-heading">Pending invitations</h2><button type="button" className="overview-link" onClick={onChange}>Refresh invitations</button></div>
        <p>Organization and colleague invitations awaiting a response.</p>
        {invitations.length ? <div className="consortium-table-scroll"><table>
          <thead><tr>{["Organization", "Invited contact", "Type", "Expires", "Status"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{invitations.map(invitation => <tr key={invitation.id}>
            <th scope="row">{invitation.legal_name}</th><td>{invitation.recipient_email}</td>
            <td>{invitation.kind === "member" ? `Colleague (${invitation.granted_role.replaceAll("_", " ")})` : "Organization"}</td>
            <td><time dateTime={invitation.expires_at}>{new Date(invitation.expires_at).toLocaleDateString()}</time></td>
            <td><span className="consortium-status" data-status="pending">Pending</span></td>
          </tr>)}</tbody>
        </table></div> : <p>No pending invitations to manage.</p>}
      </section>
      {!editableProposal && <p className="overview-updated">This proposal is read-only.</p>}
    </main>
  );
  return (
    <main className="proposal-overview consortium-page consortium-edit">
      <header className="overview-heading consortium-edit-header">
        <button type="button" className="overview-link" onClick={() => { setScreen("review"); setEditMessage(null); }}><span aria-hidden="true">←</span> Back to consortium</button>
        <h1>{canEditConsortium ? "Edit consortium" : "Consortium details"}</h1>
        <p>{selectedProposal.title}</p>
      </header>
      <section className="overview-panel consortium-edit-panel" aria-labelledby="consortium-responsibilities-heading">
        <div className="consortium-edit-section-heading">
          <h2 id="consortium-responsibilities-heading">Responsibilities</h2>
          <span className="consortium-edit-count">{countLabel(selectedProposal.responsibilities.length, "responsibility", "responsibilities")}</span>
          <p>Define what needs to be done and assign partners to each responsibility.</p>
        </div>
        {responsibilityMessage && <p className="consortium-edit-feedback" role="status">{responsibilityMessage}</p>}
        {selectedProposal.responsibilities.length === 0 && <p className="consortium-edit-empty">No responsibilities yet.</p>}
        {selectedProposal.responsibilities.map((responsibility) => <article className="consortium-edit-item" key={responsibility.id}>
          {canManageResponsibilities && editingResponsibility === responsibility.id ? <form className="consortium-edit-form" onSubmit={async (event) => {
            event.preventDefault();
            const data = Object.fromEntries(new FormData(event.currentTarget));
            if (await changeResponsibility(selectedProposal.id, "PATCH", responsibility.id, undefined, data)) setEditingResponsibility(null);
          }}>
            <label>Title <input name="title" defaultValue={responsibility.title} required /></label>
            <label>Description <input name="description" defaultValue={responsibility.description ?? ""} /></label>
            <div className="consortium-edit-actions">
              <button className="consortium-primary" disabled={responsibilityBusy}>Save responsibility</button>
              <button className="consortium-edit-button" type="button" onClick={() => setEditingResponsibility(null)}>Cancel</button>
            </div>
          </form> : <div className="consortium-edit-row">
            <div><h3>{responsibility.title}</h3>{responsibility.description && <p>{responsibility.description}</p>}</div>
            {canManageResponsibilities && <div className="consortium-edit-actions">
              <button className="consortium-edit-button" type="button" disabled={responsibilityBusy} onClick={() => setEditingResponsibility(responsibility.id)}>Edit</button>
              <button className="consortium-edit-button consortium-edit-danger" type="button" disabled={responsibilityBusy} onClick={() => { if (window.confirm(`Remove ${responsibility.title}? It and its assignments will be marked as removed.`)) void changeResponsibility(selectedProposal.id, "DELETE", responsibility.id); }}>Remove</button>
            </div>}
          </div>}
          <fieldset className="consortium-assignment"><legend>Assigned partners</legend>
            {selectedProposal.partners.length ? <div>
              {selectedProposal.partners.map((partner) => <label key={partner.id}>
                <input type="checkbox" checked={responsibility.partner_ids.includes(partner.id)} disabled={responsibilityBusy || !canManageResponsibilities} onChange={(event) => void changeResponsibility(selectedProposal.id, event.target.checked ? "PUT" : "DELETE", responsibility.id, partner.id)} /> {partner.legal_name}
              </label>)}
            </div> : <p>No partners available to assign.</p>}
          </fieldset>
        </article>)}
        {canManageResponsibilities ? <details className="consortium-edit-disclosure">
          <summary>Add a responsibility</summary>
          <form className="consortium-edit-form" onSubmit={(event) => createResponsibility(event, selectedProposal.id)}>
            <label>Title <input name="title" required /></label>
            <label>Description <input name="description" /></label>
            <div className="consortium-edit-actions"><button className="consortium-primary" disabled={responsibilityBusy}>Create responsibility</button></div>
          </form>
        </details> : <p className="consortium-edit-empty">Only the coordinator can change responsibilities while the proposal is editable.</p>}
      </section>
      <section className="overview-panel consortium-edit-panel" aria-labelledby="consortium-management-heading">
        <div className="consortium-edit-section-heading">
          <h2 id="consortium-management-heading">Partner management</h2>
          <span className="consortium-edit-count">{countLabel(selectedProposal.partners.length, "partner")}</span>
          <p>Open an organization to see its contacts, members and invitations.</p>
        </div>
        {partnerMessage && !selectedProposal.partners.some(partner => partner.id === partnerMessage.partnerId) && <p className="consortium-edit-feedback" role="status">{partnerMessage.text}</p>}
        {selectedProposal.partners.map((partner) => {
          const editable = partner.can_manage_contacts && editableProposal;
          const isCoordinator = partner.id === selectedProposal.coordinator_partner_id;
          const canChangeRoles = canManageResponsibilities && !isCoordinator;
          const canWithdraw = editableProposal && !isCoordinator && partner.can_withdraw;
          const colleagueInvitations = invitations.filter(invitation => invitation.kind === "member" && invitation.partner_id === partner.id);
          const contactForm = (contact?: Contact) => (
            <form className="consortium-edit-form" onSubmit={(event) => submitContact(event, selectedProposal.id, partner.id, contact?.id)}>
              <label>Name <input name="fullName" defaultValue={contact?.full_name ?? ""} required /></label>
              <label>Email <input name="email" type="email" defaultValue={contact?.email ?? ""} required /></label>
              <label>Job title <input name="jobTitle" defaultValue={contact?.job_title ?? ""} /></label>
              <label>Phone <input name="phone" defaultValue={contact?.phone ?? ""} /></label>
              <div className="consortium-edit-actions">
                <button className="consortium-primary" disabled={editingSave}>{contact ? "Save contact" : "Add contact"}</button>
                {contact && <button className="consortium-edit-button" type="button" onClick={() => setEditingContact(null)}>Cancel</button>}
              </div>
            </form>
          );
          return <details className="consortium-partner-editor" key={partner.id}>
            <summary>
              <span><strong>{partner.legal_name}</strong><small>{roleOf(partner.id)} · {countLabel(partner.contacts.length, "contact")} · {countLabel(partner.members.length, "member")}</small></span>
              <span className="consortium-status" data-status={partner.status}>{partner.status}</span>
            </summary>
            <div className="consortium-partner-body">
              {editMessage?.partnerId === partner.id && <p className="consortium-edit-feedback" role="status">{editMessage.text}</p>}
              {partnerMessage?.partnerId === partner.id && <p className="consortium-edit-feedback" role="status">{partnerMessage.text}</p>}
              <div className="consortium-editor-grid">
                <section>
                  <h3>Contacts</h3>
                  <p className="consortium-edit-note">{editable ? "Contacts don’t get proposal access unless invited separately." : !partner.can_manage_contacts ? "You can view but not manage this partner’s contacts." : "This proposal is read-only."}</p>
                  {partner.contacts.length === 0 && <p className="consortium-edit-empty">No contacts listed.</p>}
                  {partner.contacts.map((contact) => <div className="consortium-edit-record" key={contact.id}>
                    {editingContact === contact.id && editable ? contactForm(contact) : <>
                      <strong>{contact.full_name}</strong>{contact.id === partner.primary_contact_id && <span className="consortium-primary-contact">Primary contact</span>}
                      <p>{contact.email}</p>
                      {(contact.job_title || contact.phone) && <p>{[contact.job_title, contact.phone].filter(Boolean).join(" · ")}</p>}
                      {editable && <div className="consortium-edit-actions">
                        <button className="consortium-edit-button" type="button" disabled={editingSave} onClick={() => setEditingContact(contact.id)}>Edit</button>
                        {contact.id !== partner.primary_contact_id && <>
                          <button className="consortium-edit-button" type="button" disabled={editingSave} onClick={() => changeContact(selectedProposal.id, partner.id, "PATCH", contact.id, undefined, true)}>Make primary</button>
                          <button className="consortium-edit-button consortium-edit-danger" type="button" disabled={editingSave} onClick={() => { if (window.confirm(`Remove ${contact.full_name} from contacts?`)) void changeContact(selectedProposal.id, partner.id, "DELETE", contact.id); }}>Remove</button>
                        </>}
                      </div>}
                    </>}
                  </div>)}
                  {editable && <details className="consortium-edit-disclosure"><summary>Add a contact</summary>{contactForm()}</details>}
                </section>
                <section>
                  <h3>Proposal access</h3>
                  <p className="consortium-edit-note">Members who can sign in and access this proposal.</p>
                  {partner.members.length === 0 && <p className="consortium-edit-empty">No members with access.</p>}
                  {partner.members.map((member) => <div className="consortium-edit-record consortium-edit-row" key={member.id}>
                    <div><strong>{member.display_name}</strong><p>{member.email}</p></div>
                    {canChangeRoles ? <select aria-label={`Role for ${member.display_name}`} value={member.access_role} disabled={partnerBusy} onChange={(event) => void changePartner(selectedProposal.id, partner.id, { role: event.target.value }, member.id)}><option value="partner_admin">Partner admin</option><option value="contributor">Contributor</option><option value="viewer">Viewer</option></select> : <span className="consortium-edit-role">{member.access_role.replaceAll("_", " ")}</span>}
                  </div>)}
                  {(editable || selectedProposal.can_manage_responsibilities) && <div className="consortium-edit-invitations">
                    <h4>Pending colleague invitations</h4>
                    {colleagueInvitations.length ? <ul>{colleagueInvitations.map((invitation) => <li key={invitation.id}>
                      <strong>{invitation.recipient_email}</strong>
                      <p><span className="consortium-edit-role">{invitation.granted_role.replaceAll("_", " ")}</span> · Expires <time dateTime={invitation.expires_at}>{new Date(invitation.expires_at).toLocaleDateString()}</time></p>
                    </li>)}</ul> : <p>No pending colleague invitations.</p>}
                  </div>}
                  {editable && <details className="consortium-edit-disclosure">
                    <summary>Invite a colleague</summary>
                    <form className="consortium-edit-form" onSubmit={(event) => inviteColleague(event, selectedProposal.id, partner.id)}>
                      <label>Email <input name="email" type="email" required /></label>
                      <label>Role <select name="role" defaultValue="viewer"><option value="viewer">Viewer</option><option value="contributor">Contributor</option><option value="partner_admin">Partner admin</option></select></label>
                      <div className="consortium-edit-actions"><button className="consortium-primary" disabled={inviteBusy}>Invite colleague</button></div>
                    </form>
                  </details>}
                </section>
              </div>
              {(canChangeRoles || canWithdraw) && <div className="consortium-partner-status">
                <p>Removing or withdrawing a partner revokes its members’ proposal access.</p>
                <div className="consortium-edit-actions">
                  {canChangeRoles && <button className="consortium-edit-button consortium-edit-danger" type="button" disabled={partnerBusy} onClick={() => { if (window.confirm(`Remove ${partner.legal_name}? Its members will lose proposal access.`)) void changePartner(selectedProposal.id, partner.id, { status: "removed" }); }}>Remove partner</button>}
                  {canWithdraw && <button className="consortium-edit-button consortium-edit-danger" type="button" disabled={partnerBusy} onClick={() => { if (window.confirm(`Withdraw ${partner.legal_name}? Its members will lose proposal access.`)) void changePartner(selectedProposal.id, partner.id, { status: "withdrawn" }); }}>Withdraw partner</button>}
                </div>
              </div>}
            </div>
          </details>;
        })}
        {selectedProposal.partners.length === 0 && <p className="consortium-edit-empty">No active partners.</p>}
      </section>
    </main>
  );

}
