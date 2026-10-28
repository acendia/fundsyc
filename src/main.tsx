import { createRoot } from "react-dom/client";
import { ConsortiumPartner, Organization, PartnerContact, Proposal, Responsibility } from "./models";

const now = new Date();
const proposal = new Proposal("proposal-1", "Collaborative Research Proposal", "CRP", "draft", "partner-1", "user-1", now, now);
const organization = new Organization("org-1", "Example University", "EU", "university", "GR", "Athens", null, null, null, now, now);
const partner = new ConsortiumPartner("partner-1", proposal.id, organization.id, "active", "contact-1", now, null, now, now);
const contact = new PartnerContact("contact-1", proposal.id, partner.id, "Example Researcher", "researcher@example.org", "researcher@example.org", null, null, null, now, now);
const responsibility = new Responsibility("responsibility-1", proposal.id, "Proposal coordination", null, 0, now, now);

function App() {
  return (
    <main>
      <h1>FundSyc</h1>
      <p>Example data for now. Changes are not saved.</p>
      <section>
        <h2>Proposal</h2>
        <p><strong>Title:</strong> {proposal.title} ({proposal.acronym})</p>
        <p><strong>Status:</strong> {proposal.status}</p>
      </section>
      <section>
        <h2>Consortium</h2>
        <table>
          <thead>
            <tr><th scope="col">Organization</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Contact</th><th scope="col">Responsibility</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{organization.legalName} ({organization.city}, {organization.countryCode})</td>
              <td>{partner.id === proposal.coordinatorPartnerId ? "Coordinator" : "Beneficiary"}</td>
              <td>{partner.status}</td>
              <td>{contact.fullName} ({contact.email})</td>
              <td>{responsibility.title}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
