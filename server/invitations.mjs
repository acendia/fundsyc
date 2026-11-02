import { randomUUID, randomBytes, createHash } from "node:crypto";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function addInvitations(app) {
  app.get("/api/invitations", async (req, res) => {
    if (!req.verifiedEmail) return res.json([]);
    try {
      const result = await req.database.query(`select i.id, p.title, o.legal_name
        from consortium_invitations i join proposals p on p.id=i.proposal_id
        join consortium_partners cp on cp.id=i.partner_id and cp.proposal_id=i.proposal_id
        join organizations o on o.id=cp.organization_id
        where i.recipient_email_key=$1 and i.kind='organization' and i.status='pending'
          and i.expires_at>now() and cp.status='invited' order by i.created_at`, [req.verifiedEmail]);
      res.json(result.rows);
    } catch (error) { console.error("invitation list failed", error); res.status(500).json({ error: "Could not load invitations." }); }
  });

  app.post("/api/invitations", async (req, res) => {
    const { proposalId, organization, countryCode, city, email } = req.body ?? {};
    if (typeof proposalId !== "string" || !uuid.test(proposalId) || typeof organization !== "string" || !organization.trim() || typeof countryCode !== "string" || !/^[a-z]{2}$/i.test(countryCode.trim()) || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || (city != null && typeof city !== "string")) return res.status(400).json({ error: "Enter an organization, country code and valid email." });
    let client;
    try {
      client = await req.database.connect(); await client.query("begin");
      const proposal = await client.query("select status, coordinator_partner_id from proposals where id=$1 for update", [proposalId]);
      if (!proposal.rowCount || !["draft", "in_preparation"].includes(proposal.rows[0].status)) { await client.query("rollback"); return res.status(409).json({ error: "Proposal is unavailable or read-only." }); }
      const allowed = await client.query("select 1 from proposal_memberships where proposal_id=$1 and partner_id=$2 and user_id=$3 and status='active' and access_role='coordinator_manager'", [proposalId, proposal.rows[0].coordinator_partner_id, req.userId]);
      if (!allowed.rowCount) { await client.query("rollback"); return res.status(403).json({ error: "Only the coordinator can invite organizations." }); }
      const duplicate = await client.query("select 1 from consortium_partners cp join organizations o on o.id=cp.organization_id where cp.proposal_id=$1 and cp.status in ('active','invited') and lower(trim(o.legal_name))=lower(trim($2))", [proposalId, organization]);
      if (duplicate.rowCount) { await client.query("rollback"); return res.status(409).json({ error: "This organization is already active or invited in this proposal." }); }
      const existing = await client.query("select 1 from proposal_memberships m join users u on u.id=m.user_id where m.proposal_id=$1 and u.email_key=$2", [proposalId, email.trim().toLowerCase()]);
      if (existing.rowCount) { await client.query("rollback"); return res.status(409).json({ error: "This account already has a membership in the proposal." }); }
      const orgId = randomUUID(), partnerId = randomUUID(), id = randomUUID(), emailKey = email.trim().toLowerCase();
      await client.query("insert into organizations(id,legal_name,organization_type,country_code,city) values($1,$2,'other',$3,$4)", [orgId, organization.trim(), countryCode.trim().toUpperCase(), city?.trim() || null]);
      await client.query("insert into consortium_partners(id,proposal_id,organization_id,status) values($1,$2,$3,'invited')", [partnerId, proposalId, orgId]);
      await client.query("insert into consortium_invitations(id,proposal_id,partner_id,kind,recipient_email,recipient_email_key,granted_role,token_hash,invited_by_user_id,expires_at) values($1,$2,$3,'organization',$4,$5,'partner_admin',$6,$7,now()+interval '7 days')", [id, proposalId, partnerId, email.trim(), emailKey, createHash("sha256").update(randomBytes(32)).digest("hex"), req.userId]);
      await client.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id) values($1,$2,$3,'invitation.created','consortium_invitation',$4)", [randomUUID(), proposalId, req.userId, id]);
      await client.query("commit"); res.status(201).json({ ok: true });
    } catch (error) { if (client) await client.query("rollback").catch(() => {}); console.error("invitation creation failed", error); res.status(500).json({ error: "Could not create invitation." }); } finally { client?.release(); }
  });

  app.post("/api/invitations/:id/resolve", async (req, res) => {
    if (!uuid.test(req.params.id) || !["accept", "decline"].includes(req.body?.action)) return res.status(400).json({ error: "Invalid invitation." });
    if (!req.verifiedEmail) return res.status(403).json({ error: "A verified email is required." });
    let client;
    try {
      client = await req.database.connect(); await client.query("begin");
      const lookup = await client.query("select proposal_id from consortium_invitations where id=$1 and recipient_email_key=$2", [req.params.id, req.verifiedEmail]);
      if (!lookup.rowCount) { await client.query("rollback"); return res.status(404).json({ error: "Invitation not found." }); }
      const proposal = await client.query("select status from proposals where id=$1 for update", [lookup.rows[0].proposal_id]);
      const result = await client.query("select * from consortium_invitations where id=$1 for update", [req.params.id]);
      const invitation = result.rows[0];
      if (invitation.status !== "pending" || new Date(invitation.expires_at) <= new Date() || invitation.kind !== "organization" || !["draft", "in_preparation"].includes(proposal.rows[0].status)) { await client.query("rollback"); return res.status(409).json({ error: "Invitation is no longer available." }); }
      const partner = await client.query("select id from consortium_partners where id=$1 and proposal_id=$2 and status='invited' for update", [invitation.partner_id, invitation.proposal_id]);
      if (!partner.rowCount) { await client.query("rollback"); return res.status(409).json({ error: "Partner is no longer invited." }); }
      if (req.body.action === "accept") {
        const user = await client.query("select display_name from users where id=$1 and status='active'", [req.userId]);
        const existing = await client.query("select 1 from proposal_memberships where proposal_id=$1 and user_id=$2", [invitation.proposal_id, req.userId]);
        if (existing.rowCount) { await client.query("rollback"); return res.status(409).json({ error: "You already have a membership in this proposal." }); }
        const contactId = randomUUID();
        await client.query("insert into partner_contacts(id,proposal_id,partner_id,full_name,email,email_key,user_id) values($1,$2,$3,$4,$5,$6,$7)", [contactId, invitation.proposal_id, invitation.partner_id, user.rows[0].display_name, invitation.recipient_email, invitation.recipient_email_key, req.userId]);
        await client.query("update consortium_partners set status='active',primary_contact_id=$1,joined_at=now(),updated_at=now() where id=$2", [contactId, invitation.partner_id]);
        await client.query("insert into proposal_memberships(id,proposal_id,partner_id,user_id,access_role,granted_by_user_id) values($1,$2,$3,$4,'partner_admin',$5)", [randomUUID(), invitation.proposal_id, invitation.partner_id, req.userId, invitation.invited_by_user_id]);
        await client.query("update consortium_invitations set status='accepted',accepted_by_user_id=$1,resolved_at=now(),updated_at=now() where id=$2", [req.userId, invitation.id]);
      } else {
        await client.query("update consortium_invitations set status='declined',resolved_at=now(),updated_at=now() where id=$1", [invitation.id]);
        await client.query("update consortium_partners set status='removed',ended_at=now(),updated_at=now() where id=$1", [invitation.partner_id]);
      }
      await client.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id) values($1,$2,$3,$4,'consortium_invitation',$5)", [randomUUID(), invitation.proposal_id, req.userId, `invitation.${req.body.action === "accept" ? "accepted" : "declined"}`, invitation.id]);
      await client.query("commit"); res.json({ ok: true });
    } catch (error) { if (client) await client.query("rollback").catch(() => {}); console.error("invitation resolution failed", error); res.status(500).json({ error: "Could not resolve invitation." }); } finally { client?.release(); }
  });
}
