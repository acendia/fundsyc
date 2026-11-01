import { randomUUID } from "node:crypto";

const demoUserId = "00000000-0000-4000-8000-000000000001";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function addResponsibilityRoutes(app) {
  const base = "/api/proposals/:proposalId/responsibilities";
  async function change(request, response, action) {
    const { proposalId, responsibilityId, partnerId } = request.params;
    if (![proposalId, ...[responsibilityId, partnerId].filter(Boolean)].every((id) => uuid.test(id))) return response.status(404).json({ error: "Record not found." });
    const { title, description } = request.body ?? {};
    if (action === "create" && (typeof title !== "string" || !title.trim() || (description != null && typeof description !== "string"))) return response.status(400).json({ error: "Enter a responsibility title." });
    let client;
    try {
      client = await request.database.connect();
      await client.query("begin");
      const proposal = await client.query("select status, coordinator_partner_id from proposals where id=$1 for update", [proposalId]);
      if (!proposal.rowCount) { await client.query("rollback"); return response.status(404).json({ error: "Proposal not found." }); }
      if (!["draft", "in_preparation"].includes(proposal.rows[0].status)) { await client.query("rollback"); return response.status(409).json({ error: "This proposal is read-only." }); }
      const allowed = await client.query("select 1 from proposal_memberships m join users u on u.id=m.user_id where m.proposal_id=$1 and m.partner_id=$2 and m.user_id=$3 and m.status='active' and m.access_role='coordinator_manager' and u.status='active'", [proposalId, proposal.rows[0].coordinator_partner_id, demoUserId]);
      if (!allowed.rowCount) { await client.query("rollback"); return response.status(403).json({ error: "Only the coordinator can manage responsibilities." }); }
      const id = responsibilityId || randomUUID();
      if (action === "create") {
        await client.query("insert into responsibilities(id, proposal_id, title, description) values ($1,$2,$3,$4)", [id, proposalId, title.trim(), description?.trim() || null]);
      } else {
        const responsibility = await client.query("select id from responsibilities where id=$1 and proposal_id=$2", [id, proposalId]);
        const partner = await client.query("select id from consortium_partners where id=$1 and proposal_id=$2 and status='active'", [partnerId, proposalId]);
        if (!responsibility.rowCount || !partner.rowCount) { await client.query("rollback"); return response.status(404).json({ error: "Responsibility or active partner not found." }); }
        if (action === "assign") await client.query("insert into partner_responsibilities(proposal_id, partner_id, responsibility_id) values ($1,$2,$3) on conflict do nothing", [proposalId, partnerId, id]);
        else await client.query("delete from partner_responsibilities where proposal_id=$1 and partner_id=$2 and responsibility_id=$3", [proposalId, partnerId, id]);
      }
      await client.query("insert into audit_events(id, proposal_id, actor_user_id, action, entity_type, entity_id) values ($1,$2,$3,$4,'responsibility',$5)", [randomUUID(), proposalId, demoUserId, `responsibility.${{create:'created', assign:'assigned', unassign:'unassigned'}[action]}`, id]);
      await client.query("commit");
      response.status(action === "create" ? 201 : 200).json({ ok: true });
    } catch (error) {
      if (client) await client.query("rollback").catch(() => {});
      console.error("responsibility change failed", error);
      response.status(500).json({ error: "Could not save responsibility changes." });
    } finally { client?.release(); }
  }
  app.post(base, (req, res) => change(req, res, "create"));
  app.put(`${base}/:responsibilityId/partners/:partnerId`, (req, res) => change(req, res, "assign"));
  app.delete(`${base}/:responsibilityId/partners/:partnerId`, (req, res) => change(req, res, "unassign"));
}
