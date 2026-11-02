import express from "express";
import { addResponsibilityRoutes } from "./responsibilities.mjs";
import { addPartnerRoutes } from "./partners.mjs";
import { addContactRoutes } from "./contacts.mjs";
import { addInvitations } from "./invitations.mjs";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { users, organizations, proposals, partners, contacts, memberships, auditEvents } from "../db/tables.mjs";

export function createApp(getConnectionString, { authUrl, authKey } = {}) {
const app = express();
app.use(express.json());

// each request owns its connections, including in the worker runtime
app.use((request, response, next) => {
  const connectionString = getConnectionString();
  const pool = new pg.Pool(connectionString ? { connectionString } : { database: "fundsyc" });
  request.database = pool;
  response.on("finish", () => { void pool.end().catch((error) => console.error("database cleanup failed", error)); });
  next();
});

app.get("/api/auth/config", (_request, response) => {
  if (!authUrl || !authKey) return response.status(503).json({ error: "Sign-in is not configured." });
  response.json({ url: authUrl, key: authKey });
});

app.use("/api", async (request, response, next) => {
  const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!authUrl || !authKey) return response.status(503).json({ error: "Sign-in is not configured." });
  if (!token) return response.status(401).json({ error: "Sign in required." });
  try {
    const verified = await fetch(`${authUrl}/auth/v1/user`, { headers: { apikey: authKey, authorization: `Bearer ${token}` } });
    if (!verified.ok) return response.status(401).json({ error: "Invalid session." });
    const user = await verified.json();
    const result = await request.database.query("select id from users where auth_subject=$1 and status='active'", [user.id]);
    if (!result.rowCount) return response.status(403).json({ error: "No application account found." });
    request.userId = result.rows[0].id;
    request.verifiedEmail = user.email_confirmed_at && typeof user.email === "string" ? user.email.trim().toLowerCase() : null;
    next();
  } catch (error) { console.error("authentication failed", error); response.status(503).json({ error: "Sign-in service unavailable." }); }
});

app.post("/api/proposals", async (request, response) => {
  const { title, acronym, organization, countryCode, city } = request.body ?? {};
  if (typeof title !== "string" || !title.trim() || typeof organization !== "string" || !organization.trim() || typeof countryCode !== "string" || !/^[A-Za-z]{2}$/.test(countryCode.trim()) || (acronym != null && typeof acronym !== "string") || (city != null && typeof city !== "string")) {
    return response.status(400).json({ error: "Enter a title, organization, and two-letter country code." });
  }
  let client;
  try {
    client = await request.database.connect();
    await client.query("begin");
    const tx = drizzle(client);
    const user = await tx.select().from(users).where(and(eq(users.id, request.userId), eq(users.status, "active")));
    if (!user.length) {
      await client.query("rollback");
      return response.status(400).json({ error: "Run the database seed to create the demo user first." });
    }
    const [proposalId, partnerId, organizationId, contactId, membershipId, auditId] = Array.from({ length: 6 }, () => randomUUID());
    const actor = user[0];
    await tx.insert(organizations).values({ id: organizationId, legalName: organization.trim(), organizationType: "other", countryCode: countryCode.trim().toUpperCase(), city: city?.trim() || null });
    await tx.insert(proposals).values({ id: proposalId, title: title.trim(), acronym: acronym?.trim() || null, coordinatorPartnerId: partnerId, createdByUserId: request.userId });
    await tx.insert(partners).values({ id: partnerId, proposalId, organizationId, status: "active", primaryContactId: contactId, joinedAt: new Date() });
    await tx.insert(contacts).values({ id: contactId, proposalId, partnerId, fullName: actor.displayName, email: actor.email, emailKey: actor.emailKey, userId: request.userId });
    await tx.insert(memberships).values({ id: membershipId, proposalId, partnerId, userId: request.userId, accessRole: "coordinator_manager", grantedByUserId: request.userId });
    await tx.insert(auditEvents).values({ id: auditId, proposalId, actorUserId: request.userId, action: "proposal.created", entityType: "proposal", entityId: proposalId });
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
    client = await request.database.connect();
    await client.query("begin");
    const proposal = await client.query("select status from proposals where id = $1 for update", [request.params.proposalId]);
    if (!proposal.rowCount) { await client.query("rollback"); return response.status(404).json({ error: "Proposal not found." }); }
    if (!['draft', 'in_preparation'].includes(proposal.rows[0].status)) { await client.query("rollback"); return response.status(409).json({ error: "This proposal is read-only." }); }
    const allowed = await client.query("select 1 from proposal_memberships m join users u on u.id = m.user_id where m.proposal_id = $1 and m.partner_id = $2 and m.user_id = $3 and m.status = 'active' and m.access_role in ('coordinator_manager', 'partner_admin') and u.status = 'active'", [request.params.proposalId, request.params.partnerId, request.userId]);
    if (!allowed.rowCount) { await client.query("rollback"); return response.status(403).json({ error: "The demo user cannot edit this partner." }); }
    const tx = drizzle(client);
    const partner = await tx.select({ contactId: partners.primaryContactId }).from(partners).where(and(eq(partners.proposalId, request.params.proposalId), eq(partners.id, request.params.partnerId), eq(partners.status, "active")));
    if (!partner.length || !partner[0].contactId) { await client.query("rollback"); return response.status(404).json({ error: "Primary contact not found." }); }
    const updated = await tx.update(contacts).set({ fullName: fullName.trim(), email: email.trim(), emailKey: email.trim().toLowerCase(), updatedAt: new Date() }).where(and(eq(contacts.id, partner[0].contactId), eq(contacts.partnerId, request.params.partnerId), eq(contacts.proposalId, request.params.proposalId))).returning({ id: contacts.id });
    if (!updated.length) { await client.query("rollback"); return response.status(404).json({ error: "Primary contact not found." }); }
    await tx.insert(auditEvents).values({ id: randomUUID(), proposalId: request.params.proposalId, actorUserId: request.userId, action: "contact.updated", entityType: "partner_contact", entityId: updated[0].id });
    await client.query("commit");
    response.json({ ok: true });
  } catch (error) {
    if (client) await client.query("rollback").catch(() => {});
    if ((error.cause?.code ?? error.code) === '23505') return response.status(409).json({ error: "That email is already used by another contact." });
    console.error("contact update failed", error);
    response.status(500).json({ error: "Could not update the contact." });
  } finally { client?.release(); }
});

app.get("/api/proposals", async (request, response) => {
  try {
    const pool = request.database;
    const db = drizzle(pool);
    const proposalRows = await db.select({ id: proposals.id, title: proposals.title, acronym: proposals.acronym, status: proposals.status, coordinator_partner_id: proposals.coordinatorPartnerId }).from(proposals).orderBy(proposals.createdAt, proposals.id);
    const partners = await pool.query(`
      select p.proposal_id, p.id, p.status, p.primary_contact_id, o.legal_name, o.city, o.country_code,
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
    const contactRows = await pool.query("select id, proposal_id, partner_id, full_name, email, job_title, phone from partner_contacts order by full_name, id");
    const managed = await pool.query("select partner_id from proposal_memberships m join users u on u.id=m.user_id where m.user_id=$1 and m.status='active' and m.access_role in ('coordinator_manager','partner_admin') and u.status='active'", [request.userId]);
    const managedIds = new Set(managed.rows.map((row) => row.partner_id));
    const responsibilityRows = await pool.query("select r.id, r.proposal_id, r.title, r.description, coalesce(array_agg(pr.partner_id) filter (where pr.partner_id is not null), '{}') as partner_ids from responsibilities r left join partner_responsibilities pr on pr.responsibility_id=r.id and pr.proposal_id=r.proposal_id group by r.id order by r.sort_order, r.title, r.id");
    const coordinatorRows = await pool.query("select m.proposal_id from proposal_memberships m join proposals p on p.id=m.proposal_id and p.coordinator_partner_id=m.partner_id join users u on u.id=m.user_id where m.user_id=$1 and m.status='active' and m.access_role='coordinator_manager' and u.status='active'", [request.userId]);
    const memberRows = await pool.query("select m.id, m.proposal_id, m.partner_id, m.user_id, m.access_role, u.display_name, u.email from proposal_memberships m join users u on u.id=m.user_id where m.status='active' order by u.display_name, m.id");
    const coordinatorIds = new Set(coordinatorRows.rows.map((row) => row.proposal_id));
    const visible = await pool.query("select m.proposal_id from proposal_memberships m join consortium_partners p on p.id=m.partner_id and p.proposal_id=m.proposal_id where m.user_id=$1 and m.status='active' and p.status='active'", [request.userId]);
    const visibleIds = new Set(visible.rows.map((row) => row.proposal_id));
    response.json(proposalRows.filter((proposal) => visibleIds.has(proposal.id)).map((proposal) => ({
      ...proposal,
      responsibilities: responsibilityRows.rows.filter((row) => row.proposal_id === proposal.id),
      can_manage_responsibilities: coordinatorIds.has(proposal.id),
      partners: partners.rows.filter((partner) => partner.proposal_id === proposal.id).map((partner) => ({
        ...partner,
        contacts: contactRows.rows.filter((contact) => contact.partner_id === partner.id && contact.proposal_id === proposal.id),
        primary_contact_id: partner.primary_contact_id,
        can_manage_contacts: managedIds.has(partner.id),
        can_withdraw: memberRows.rows.some((m) => m.partner_id === partner.id && m.user_id === request.userId && m.access_role === "partner_admin"),
        members: memberRows.rows.filter((m) => m.partner_id === partner.id && m.proposal_id === proposal.id),
      })),
    })));
  } catch (error) {
    console.error("database query failed", error);
    response.status(500).json({ error: "could not load proposals" });
  }
});

addInvitations(app);
addPartnerRoutes(app);
addContactRoutes(app);
addResponsibilityRoutes(app);

return app;
}
