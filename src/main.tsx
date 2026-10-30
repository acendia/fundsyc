import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";

type Partner = {
  id: string;
  status: string;
  legal_name: string;
  city: string | null;
  country_code: string;
  full_name: string | null;
  email: string | null;
  responsibilities: string[];
};

type Proposal = {
  id: string;
  title: string;
  acronym: string | null;
  status: string;
  coordinator_partner_id: string;
  partners: Partner[];
};

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

  async function saveContact(event: FormEvent<HTMLFormElement>, proposalId: string, partnerId: string) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setEditingSave(true);
    setEditMessage("");
    try {
      const response = await fetch(`/api/proposals/${proposalId}/partners/${partnerId}/contact`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save contact.");
      setEditMessage("Contact saved.");
      setRevision((current) => current + 1);
    } catch (error) {
      setEditMessage(error instanceof Error ? error.message : "Could not save contact.");
    } finally { setEditingSave(false); }
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
  
  // fetch proposals from the API on component mount
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
        <h3>Partners</h3>
        {selectedProposal.partners.length === 0 && <p>No active partners.</p>}
        {selectedProposal.partners.map((partner) => (
          <section key={partner.id}>
            <h4>{partner.legal_name}</h4>
            <p><strong>Role:</strong> {partner.id === selectedProposal.coordinator_partner_id ? "Coordinator" : "Beneficiary"}</p>
            <p><strong>Status:</strong> {partner.status}</p>
            <p><strong>Location:</strong> {[partner.city, partner.country_code].filter(Boolean).join(", ")}</p>
            <p><strong>Primary contact:</strong> {partner.full_name ? `${partner.full_name} (${partner.email})` : "Not listed"}</p>
            <p><strong>Responsibilities:</strong> {partner.responsibilities.join(", ") || "None listed"}</p>
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
        <p>Edit the primary contact for partners managed by the demo user.</p>
        {selectedProposal.partners.map((partner) => (
          <section key={partner.id}>
            <h3>{partner.legal_name}</h3>
            <p>{partner.id === selectedProposal.coordinator_partner_id ? "Coordinator" : "Beneficiary"} — {partner.status}</p>
            <form onSubmit={(event) => saveContact(event, selectedProposal.id, partner.id)}>
              <p><label>Contact name <input name="fullName" defaultValue={partner.full_name ?? ""} required /></label></p>
              <p><label>Contact email <input name="email" type="email" defaultValue={partner.email ?? ""} required /></label></p>
              <button disabled={editingSave || !["draft", "in_preparation"].includes(selectedProposal.status)}>Save contact</button>
            </form>
          </section>
        ))}
        {selectedProposal.partners.length === 0 && <p>No active partners.</p>}
      </>}
      {editMessage && <p role="status">{editMessage}</p>}
    </main>
  );

  return (
    <main>
      <h1>FundSyc</h1>
      <section>
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
        <section key={proposal.id}>
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
        <section>
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
