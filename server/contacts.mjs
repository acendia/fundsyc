import { randomUUID } from "node:crypto";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function addContactRoutes(app) {
  const path = "/api/proposals/:proposalId/partners/:partnerId/contacts";
  async function change(request, response, action) {
    const { proposalId, partnerId, contactId } = request.params;
    if (![proposalId, partnerId, ...(contactId ? [contactId] : [])].every((id) => uuid.test(id))) return response.status(404).json({ error: "Contact not found." });
    const { fullName, email, jobTitle, phone } = request.body ?? {};
    if (["create", "update"].includes(action) && (typeof fullName !== "string" || !fullName.trim() || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || (jobTitle != null && typeof jobTitle !== "string") || (phone != null && typeof phone !== "string"))) return response.status(400).json({ error: "Enter a name and valid email." });
    let client;
    try {
      client = await request.database.connect();
      await client.query("begin");
      const proposal = await client.query("select status from proposals where id = $1 for update", [proposalId]);
      if (!proposal.rowCount) { await client.query("rollback"); return response.status(404).json({ error: "Proposal not found." }); }
      if (!["draft", "in_preparation"].includes(proposal.rows[0].status)) { await client.query("rollback"); return response.status(409).json({ error: "This proposal is read-only." }); }
      const partner = await client.query("select primary_contact_id from consortium_partners where id = $1 and proposal_id = $2 and status = 'active' for update", [partnerId, proposalId]);
      if (!partner.rowCount) { await client.query("rollback"); return response.status(404).json({ error: "Partner not found." }); }
      const allowed = await client.query("select 1 from proposal_memberships m join users u on u.id = m.user_id where m.proposal_id = $1 and m.partner_id = $2 and m.user_id = $3 and m.status = 'active' and m.access_role in ('coordinator_manager', 'partner_admin') and u.status = 'active'", [proposalId, partnerId, request.userId]);
      if (!allowed.rowCount) { await client.query("rollback"); return response.status(403).json({ error: "The demo user cannot manage contacts for this partner." }); }
      const id = contactId || randomUUID();
      if (contactId) {
        const existing = await client.query("select id from partner_contacts where id = $1 and partner_id = $2 and proposal_id = $3", [id, partnerId, proposalId]);
        if (!existing.rowCount) { await client.query("rollback"); return response.status(404).json({ error: "Contact not found." }); }
      }
      if (action === "create") await client.query("insert into partner_contacts (id, proposal_id, partner_id, full_name, email, email_key, job_title, phone) values ($1,$2,$3,$4,$5,$6,$7,$8)", [id, proposalId, partnerId, fullName.trim(), email.trim(), email.trim().toLowerCase(), jobTitle?.trim() || null, phone?.trim() || null]);
      if (action === "update") await client.query("update partner_contacts set full_name=$1, email=$2, email_key=$3, job_title=$4, phone=$5, updated_at=now() where id=$6 and partner_id=$7 and proposal_id=$8", [fullName.trim(), email.trim(), email.trim().toLowerCase(), jobTitle?.trim() || null, phone?.trim() || null, id, partnerId, proposalId]);
      if (action === "primary") await client.query("update consortium_partners set primary_contact_id=$1, updated_at=now() where id=$2 and proposal_id=$3", [id, partnerId, proposalId]);
      if (action === "delete") {
        if (partner.rows[0].primary_contact_id === id) { await client.query("rollback"); return response.status(409).json({ error: "Choose another primary contact before removing this one." }); }
        await client.query("delete from partner_contacts where id=$1 and partner_id=$2 and proposal_id=$3", [id, partnerId, proposalId]);
      }
      await client.query("insert into audit_events (id, proposal_id, actor_user_id, action, entity_type, entity_id) values ($1,$2,$3,$4,'partner_contact',$5)", [randomUUID(), proposalId, request.userId, `contact.${{ create: "created", update: "updated", primary: "made_primary", delete: "removed" }[action]}`, id]);
      await client.query("commit");
      response.status(action === "create" ? 201 : 200).json({ ok: true });
    } catch (error) {
      if (client) await client.query("rollback").catch(() => {});
      if (error.code === "23505") return response.status(409).json({ error: "That email is already used by another contact for this partner." });
      console.error("contact change failed", error);
      response.status(500).json({ error: "Could not save contact changes." });
    } finally { client?.release(); }
  }
  app.post(path, (req, res) => change(req, res, "create"));
  app.patch(`${path}/:contactId`, (req, res) => change(req, res, "update"));
  app.patch(`${path}/:contactId/primary`, (req, res) => change(req, res, "primary"));
  app.delete(`${path}/:contactId`, (req, res) => change(req, res, "delete"));
}
