import express from "express";
import pg from "pg";
import { randomUUID } from "node:crypto";

const app = express();
app.use(express.json());
const pool = new pg.Pool({ database: "fundsyc", ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}) });

// local demo user until sign in is added
const demoUserId = "00000000-0000-4000-8000-000000000001";

app.post("/api/proposals", async (request, response) => {
  const { title, acronym, organization, countryCode, city } = request.body ?? {};
  if (typeof title !== "string" || !title.trim() || typeof organization !== "string" || !organization.trim() || typeof countryCode !== "string" || !/^[A-Za-z]{2}$/.test(countryCode.trim()) || (acronym != null && typeof acronym !== "string") || (city != null && typeof city !== "string")) {
    return response.status(400).json({ error: "Enter a title, organization, and two-letter country code." });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query("begin");
    const user = await client.query("select id, display_name, email, email_key from users where id = $1 and status = 'active'", [demoUserId]);
    if (!user.rowCount) {
      await client.query("rollback");
      return response.status(400).json({ error: "Run the database seed to create the demo user first." });
    }
    const [proposalId, partnerId, organizationId, contactId, membershipId, auditId] = Array.from({ length: 6 }, () => randomUUID());
    const actor = user.rows[0];
    await client.query("insert into organizations (id, legal_name, organization_type, country_code, city) values ($1, $2, 'other', $3, $4)", [organizationId, organization.trim(), countryCode.trim().toUpperCase(), city?.trim() || null]);
    await client.query("insert into proposals (id, title, acronym, coordinator_partner_id, created_by_user_id) values ($1, $2, $3, $4, $5)", [proposalId, title.trim(), acronym?.trim() || null, partnerId, demoUserId]);
    await client.query("insert into consortium_partners (id, proposal_id, organization_id, status, primary_contact_id, joined_at) values ($1, $2, $3, 'active', $4, now())", [partnerId, proposalId, organizationId, contactId]);
    await client.query("insert into partner_contacts (id, proposal_id, partner_id, full_name, email, email_key, user_id) values ($1, $2, $3, $4, $5, $6, $7)", [contactId, proposalId, partnerId, actor.display_name, actor.email, actor.email_key, demoUserId]);
    await client.query("insert into proposal_memberships (id, proposal_id, partner_id, user_id, access_role, granted_by_user_id) values ($1, $2, $3, $4, 'coordinator_manager', $4)", [membershipId, proposalId, partnerId, demoUserId]);
    await client.query("insert into audit_events (id, proposal_id, actor_user_id, action, entity_type, entity_id) values ($1, $2, $3, 'proposal.created', 'proposal', $2)", [auditId, proposalId, demoUserId]);
    await client.query("commit");
    response.status(201).json({ id: proposalId });
  } catch (error) {
    if (client) await client.query("rollback").catch(() => {});
    console.error("proposal creation failed", error);
    response.status(500).json({ error: "Could not create the proposal." });
  } finally {
    client?.release();
  }
});

app.patch("/api/proposals/:proposalId/partners/:partnerId/contact", async (request, response) => {
  const { fullName, email } = request.body ?? {};
  if (typeof fullName !== "string" || !fullName.trim() || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return response.status(400).json({ error: "Enter a name and valid email." });
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(request.params.proposalId) || !uuid.test(request.params.partnerId)) return response.status(404).json({ error: "Partner not found." });
  let client;
  try {
    client = await pool.connect();
    await client.query("begin");
    const proposal = await client.query("select status from proposals where id = $1 for update", [request.params.proposalId]);
    if (!proposal.rowCount) { await client.query("rollback"); return response.status(404).json({ error: "Proposal not found." }); }
    if (!['draft', 'in_preparation'].includes(proposal.rows[0].status)) { await client.query("rollback"); return response.status(409).json({ error: "This proposal is read-only." }); }
    const allowed = await client.query("select 1 from proposal_memberships m join users u on u.id = m.user_id where m.proposal_id = $1 and m.partner_id = $2 and m.user_id = $3 and m.status = 'active' and m.access_role in ('coordinator_manager', 'partner_admin') and u.status = 'active'", [request.params.proposalId, request.params.partnerId, demoUserId]);
    if (!allowed.rowCount) { await client.query("rollback"); return response.status(403).json({ error: "The demo user cannot edit this partner." }); }
    const updated = await client.query("update partner_contacts c set full_name = $3, email = $4, email_key = $5, updated_at = now() from consortium_partners p where p.proposal_id = $1 and p.id = $2 and p.status = 'active' and c.id = p.primary_contact_id and c.partner_id = p.id and c.proposal_id = p.proposal_id returning c.id", [request.params.proposalId, request.params.partnerId, fullName.trim(), email.trim(), email.trim().toLowerCase()]);
    if (!updated.rowCount) { await client.query("rollback"); return response.status(404).json({ error: "Primary contact not found." }); }
    await client.query("insert into audit_events (id, proposal_id, actor_user_id, action, entity_type, entity_id) values ($1, $2, $3, 'contact.updated', 'partner_contact', $4)", [randomUUID(), request.params.proposalId, demoUserId, updated.rows[0].id]);
    await client.query("commit");
    response.json({ ok: true });
  } catch (error) {
    if (client) await client.query("rollback").catch(() => {});
    if (error.code === '23505') return response.status(409).json({ error: "That email is already used by another contact." });
    console.error("contact update failed", error);
    response.status(500).json({ error: "Could not update the contact." });
  } finally { client?.release(); }
});

app.get("/api/proposals", async (_request, response) => {
  try {
    const proposals = await pool.query("select id, title, acronym, status, coordinator_partner_id from proposals order by created_at, id");
    const partners = await pool.query(`
      select p.proposal_id, p.id, p.status, o.legal_name, o.city, o.country_code,
             c.full_name, c.email,
             coalesce(array_agg(r.title order by pr.sort_order, r.id) filter (where r.id is not null), '{}') as responsibilities
      from consortium_partners p
      join organizations o on o.id = p.organization_id
      left join partner_contacts c on c.id = p.primary_contact_id and c.partner_id = p.id
      left join partner_responsibilities pr on pr.partner_id = p.id and pr.proposal_id = p.proposal_id
      left join responsibilities r on r.id = pr.responsibility_id and r.proposal_id = p.proposal_id
      where p.status = 'active'
      group by p.proposal_id, p.id, o.id, c.id
      order by o.legal_name, p.id
    `);
    response.json(proposals.rows.map((proposal) => ({
      ...proposal,
      partners: partners.rows.filter((partner) => partner.proposal_id === proposal.id),
    })));
  } catch (error) {
    console.error("database query failed", error);
    response.status(500).json({ error: "could not load proposals" });
  }
});

app.get("/api/example-data", async (_request, response) => {
  try {
    const queries = {
      users: "select display_name, email, status from users order by display_name, id",
      organizations: "select legal_name, short_name, organization_type, city, country_code from organizations order by legal_name, id",
      proposals: "select title, acronym, status from proposals order by title, id",
      partners: "select p.title as proposal, o.legal_name as organization, cp.status, case when p.coordinator_partner_id = cp.id then 'coordinator' else 'beneficiary' end as role from consortium_partners cp join proposals p on p.id = cp.proposal_id join organizations o on o.id = cp.organization_id order by p.title, o.legal_name, cp.id",
      contacts: "select p.title as proposal, o.legal_name as organization, c.full_name, c.email from partner_contacts c join consortium_partners cp on cp.id = c.partner_id and cp.proposal_id = c.proposal_id join proposals p on p.id = c.proposal_id join organizations o on o.id = cp.organization_id order by c.full_name, c.id",
      memberships: "select p.title as proposal, o.legal_name as organization, u.display_name as user_name, m.access_role, m.status from proposal_memberships m join users u on u.id = m.user_id join proposals p on p.id = m.proposal_id join consortium_partners cp on cp.id = m.partner_id and cp.proposal_id = m.proposal_id join organizations o on o.id = cp.organization_id order by p.title, u.display_name, m.id",
      responsibilities: "select p.title as proposal, r.title, r.description from responsibilities r join proposals p on p.id = r.proposal_id order by p.title, r.sort_order, r.id",
      assignments: "select p.title as proposal, o.legal_name as organization, r.title as responsibility from partner_responsibilities pr join proposals p on p.id = pr.proposal_id join consortium_partners cp on cp.id = pr.partner_id and cp.proposal_id = pr.proposal_id join organizations o on o.id = cp.organization_id join responsibilities r on r.id = pr.responsibility_id and r.proposal_id = pr.proposal_id order by p.title, o.legal_name, pr.sort_order, r.id",
      invitations: "select p.title as proposal, o.legal_name as organization, i.kind, i.recipient_email, i.granted_role, i.status, i.expires_at from consortium_invitations i join proposals p on p.id = i.proposal_id join consortium_partners cp on cp.id = i.partner_id and cp.proposal_id = i.proposal_id join organizations o on o.id = cp.organization_id order by i.created_at, i.id",
      audit_events: "select p.title as proposal, a.action, a.entity_type, a.created_at from audit_events a join proposals p on p.id = a.proposal_id order by a.created_at, a.id",
    };
    const entries = await Promise.all(Object.entries(queries).map(async ([name, query]) => [name, (await pool.query(query)).rows]));
    response.json(Object.fromEntries(entries));
  } catch (error) {
    console.error("database query failed", error);
    response.status(500).json({ error: "could not load example data" });
  }
});

app.listen(3001, "127.0.0.1", () => console.log("api running at http://127.0.0.1:3001"));
