import { createHash, randomBytes, randomUUID } from "node:crypto";

const coordinatorId = "00000000-0000-4000-8000-000000000001";
const hash = (token) => createHash("sha256").update(token).digest("hex");

// local demonstration only: no email is sent and no real identity is verified
export function addDemoInvitations(app) {
  app.get("/api/demo/config", (_req, res) => res.json({ enabled: true }));
  app.post("/api/demo/invitations", async (req, res) => {
    const { proposalId, organization, countryCode, city } = req.body ?? {};
    if (typeof proposalId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proposalId) || typeof organization !== "string" || !organization.trim() || typeof countryCode !== "string" || !/^[a-z]{2}$/i.test(countryCode.trim()) || (city != null && typeof city !== "string")) return res.status(400).json({ error: "Enter an organization and a two-letter country code." });
    let client;
    try {
      client = await req.database.connect();
      await client.query("begin");
      const proposal = await client.query("select * from proposals where id=$1 for update", [proposalId]);
      if (!proposal.rowCount) { await client.query("rollback"); return res.status(404).json({ error: "Proposal not found." }); }
      if (!['draft','in_preparation'].includes(proposal.rows[0].status)) { await client.query("rollback"); return res.status(409).json({ error: "Proposal is read-only." }); }
      const permitted = await client.query("select 1 from proposal_memberships m join users u on u.id=m.user_id where m.proposal_id=$1 and m.partner_id=$2 and m.user_id=$3 and m.status='active' and m.access_role='coordinator_manager' and u.status='active'", [proposalId, proposal.rows[0].coordinator_partner_id, coordinatorId]);
      if (!permitted.rowCount) { await client.query("rollback"); return res.status(403).json({ error: "Only the coordinator manager can invite organizations." }); }
      const token = randomBytes(32).toString("hex");
      const orgId = randomUUID(), participationId = randomUUID(), invitationId = randomUUID();
      const email = `partner+${invitationId}@example.org`;
      await client.query("insert into organizations(id,legal_name,organization_type,country_code,city) values($1,$2,'other',$3,$4)", [orgId,organization.trim(),countryCode.trim().toUpperCase(),city?.trim() || null]);
      await client.query("insert into consortium_partners(id,proposal_id,organization_id,status) values($1,$2,$3,'invited')", [participationId,proposalId,orgId]);
      await client.query("insert into consortium_invitations(id,proposal_id,partner_id,kind,recipient_email,recipient_email_key,recipient_name,granted_role,token_hash,invited_by_user_id,expires_at) values($1,$2,$3,'organization',$4,$4,'Demo Partner','partner_admin',$5,$6,now()+interval '7 days')", [invitationId,proposalId,participationId,email,hash(token),coordinatorId]);
      await client.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id) values($1,$2,$3,'invitation.created','consortium_invitation',$4)", [randomUUID(),proposalId,coordinatorId,invitationId]);
      await client.query("commit");
      res.status(201).json({ token, recipient: email });
    } catch (error) { if(client) await client.query("rollback").catch(()=>{}); console.error("invitation creation failed",error); res.status(500).json({ error:"Could not create invitation." }); } finally { client?.release(); }
  });

  app.post("/api/demo/invitations/resolve", async (req, res) => {
    const { token, action } = req.body ?? {};
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !['accept','decline'].includes(action)) return res.status(400).json({error:'Invalid invitation.'});
    let client;
    try {
      client = await req.database.connect();
      await client.query('begin');
      const found = await client.query('select proposal_id from consortium_invitations where token_hash=$1', [hash(token)]);
      if (!found.rowCount) { await client.query('rollback'); return res.status(400).json({error:'Invalid or expired invitation.'}); }
      const proposal = await client.query('select * from proposals where id=$1 for update', [found.rows[0].proposal_id]);
      const invite = await client.query('select * from consortium_invitations where token_hash=$1 for update', [hash(token)]);
      const i=invite.rows[0];
      const partnerId = i.id;
      const email = `partner+${i.id}@example.org`;
      if (i.status === 'accepted' && action === 'accept' && (i.accepted_by_user_id === partnerId || i.accepted_by_user_id === '00000000-0000-4000-8000-000000000002')) { await client.query('commit'); return res.json({status:'accepted'}); }
      if (i.status !== 'pending' || new Date(i.expires_at) <= new Date() || i.kind !== 'organization' || i.recipient_email_key !== email) { await client.query('rollback'); return res.status(400).json({error:'Invalid or expired invitation.'}); }
      if (action === 'accept') {
        if (!['draft','in_preparation'].includes(proposal.rows[0].status)) { await client.query('rollback'); return res.status(409).json({error:'Proposal is read-only.'}); }
        const allowed=await client.query("select 1 from proposal_memberships m join users u on u.id=m.user_id where m.proposal_id=$1 and m.partner_id=$2 and m.user_id=$3 and m.status='active' and m.access_role='coordinator_manager' and u.status='active'",[i.proposal_id,proposal.rows[0].coordinator_partner_id,i.invited_by_user_id]);
        if (!allowed.rowCount) { await client.query('rollback'); return res.status(400).json({error:'Invalid or expired invitation.'}); }
        await client.query("insert into users(id,auth_subject,email,email_key,display_name,email_verified_at) values($1,$3,$2,$2,'Demo Partner',now()) on conflict(id) do nothing",[partnerId,email,`demo:partner:${partnerId}`]);
        const actor=await client.query("select id from users where id=$1 and email_key=$2 and status='active' and email_verified_at is not null",[partnerId,email]);
        if (!actor.rowCount) { await client.query('rollback'); return res.status(400).json({error:'Invalid or expired invitation.'}); }
        const partner=await client.query("select id from consortium_partners where id=$1 and proposal_id=$2 and status='invited' for update",[i.partner_id,i.proposal_id]);
        if (!partner.rowCount) { await client.query('rollback'); return res.status(409).json({error:'Partner is no longer invited.'}); }
        const existing=await client.query('select id from proposal_memberships where proposal_id=$1 and user_id=$2',[i.proposal_id,partnerId]);
        if (existing.rowCount) { await client.query('rollback'); return res.status(409).json({error:'The demo partner already belongs to this proposal.'}); }
        const contactId=randomUUID();
        await client.query("insert into partner_contacts(id,proposal_id,partner_id,full_name,email,email_key,user_id) values($1,$2,$3,'Demo Partner',$4,$4,$5)",[contactId,i.proposal_id,i.partner_id,email,partnerId]);
        await client.query("update consortium_partners set status='active',primary_contact_id=$1,joined_at=now(),updated_at=now() where id=$2",[contactId,i.partner_id]);
        await client.query("insert into proposal_memberships(id,proposal_id,partner_id,user_id,access_role,granted_by_user_id) values($1,$2,$3,$4,'partner_admin',$5)",[randomUUID(),i.proposal_id,i.partner_id,partnerId,i.invited_by_user_id]);
        await client.query("update consortium_invitations set status='accepted',accepted_by_user_id=$1,resolved_at=now(),updated_at=now() where id=$2",[partnerId,i.id]);
      } else {
        await client.query("update consortium_invitations set status='declined',resolved_at=now(),updated_at=now() where id=$1",[i.id]);
        await client.query("update consortium_partners set status='removed',ended_at=now(),updated_at=now() where id=$1 and status='invited'",[i.partner_id]);
      }
      const status=action==='accept'?'accepted':'declined';
      await client.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id) values($1,$2,$3,$4,'consortium_invitation',$5)",[randomUUID(),i.proposal_id,action==='accept'?partnerId:null,`invitation.${status}`,i.id]);
      await client.query('commit'); res.json({status});
    } catch(error) { if(client) await client.query('rollback').catch(()=>{}); console.error('invitation resolution failed',error); res.status(500).json({error:'Could not resolve invitation.'}); } finally {client?.release();}
  });
}
