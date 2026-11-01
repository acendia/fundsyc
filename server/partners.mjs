import { randomUUID } from "node:crypto";
const actor = "00000000-0000-4000-8000-000000000001";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function addPartnerRoutes(app) {
  async function change(req, res, operation) {
    const { proposalId, partnerId, membershipId } = req.params;
    if (![proposalId, partnerId, ...(membershipId ? [membershipId] : [])].every(id => uuid.test(id))) return res.status(404).json({ error: "Record not found." });
    const { role, status } = req.body ?? {};
    if (operation === "role" && !["partner_admin", "contributor", "viewer"].includes(role)) return res.status(400).json({ error: "Choose a valid role." });
    if (operation === "partner" && !["withdrawn", "removed"].includes(status)) return res.status(400).json({ error: "Choose a valid action." });
    let client;
    try {
      client = await req.database.connect(); await client.query("begin");
      const proposal = await client.query("select status, coordinator_partner_id from proposals where id=$1 for update", [proposalId]);
      if (!proposal.rowCount) { await client.query("rollback"); return res.status(404).json({ error: "Proposal not found." }); }
      if (!["draft", "in_preparation"].includes(proposal.rows[0].status)) { await client.query("rollback"); return res.status(409).json({ error: "This proposal is read-only." }); }
      const partner = await client.query("select status from consortium_partners where id=$1 and proposal_id=$2 for update", [partnerId, proposalId]);
      if (!partner.rowCount || partner.rows[0].status !== "active") { await client.query("rollback"); return res.status(404).json({ error: "Active partner not found." }); }
      const membership = await client.query("select m.partner_id, m.access_role from proposal_memberships m join users u on u.id=m.user_id where m.proposal_id=$1 and m.user_id=$2 and m.status='active' and u.status='active'", [proposalId, actor]);
      const current = membership.rows[0];
      const coordinator = current?.partner_id === proposal.rows[0].coordinator_partner_id && current?.access_role === 'coordinator_manager';
      const ownAdmin = current?.partner_id === partnerId && current?.access_role === 'partner_admin';
      if (!(coordinator && (operation === 'role' || status === 'removed')) && !(operation === 'partner' && status === 'withdrawn' && ownAdmin)) { await client.query("rollback"); return res.status(403).json({ error: "The demo user cannot perform this action." }); }
      if (operation === 'partner') {
        if (partnerId === proposal.rows[0].coordinator_partner_id) { await client.query("rollback"); return res.status(409).json({ error: "The coordinator cannot leave the proposal." }); }
        await client.query("update consortium_partners set status=$1, ended_at=now(), updated_at=now() where id=$2 and proposal_id=$3", [status, partnerId, proposalId]);
        await client.query("update proposal_memberships set status='revoked', revoked_at=now(), updated_at=now() where partner_id=$1 and proposal_id=$2 and status='active'", [partnerId, proposalId]);
        await client.query("update consortium_invitations set status='revoked', resolved_at=now(), updated_at=now() where partner_id=$1 and proposal_id=$2 and status='pending'", [partnerId, proposalId]);
      } else {
        const target = await client.query("select access_role from proposal_memberships where id=$1 and partner_id=$2 and proposal_id=$3 and status='active' for update", [membershipId, partnerId, proposalId]);
        if (!target.rowCount) { await client.query("rollback"); return res.status(404).json({ error: "Active membership not found." }); }
        if (target.rows[0].access_role === 'coordinator_manager' || partnerId === proposal.rows[0].coordinator_partner_id) { await client.query("rollback"); return res.status(409).json({ error: "Coordinator roles cannot be changed here." }); }
        await client.query("update proposal_memberships set access_role=$1, updated_at=now() where id=$2", [role, membershipId]);
      }
      await client.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,$3,$4,$5,$6,$7)", [randomUUID(), proposalId, actor, operation === 'partner' ? `partner.${status}` : 'membership.role_updated', operation === 'partner' ? 'consortium_partner' : 'proposal_membership', operation === 'partner' ? partnerId : membershipId, JSON.stringify(operation === 'role' ? { role } : {})]);
      await client.query("commit"); res.json({ ok: true });
    } catch (error) { if (client) await client.query("rollback").catch(() => {}); console.error("partner change failed", error); res.status(500).json({ error: "Could not save changes." }); }
    finally { client?.release(); }
  }
  app.patch('/api/proposals/:proposalId/partners/:partnerId/status', (req,res) => change(req,res,'partner'));
  app.patch('/api/proposals/:proposalId/partners/:partnerId/memberships/:membershipId', (req,res) => change(req,res,'role'));
}
