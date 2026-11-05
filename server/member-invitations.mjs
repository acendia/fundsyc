import {randomUUID,randomBytes,createHash} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function addMemberInvitations(app){
 app.post('/api/proposals/:proposalId/partners/:partnerId/member-invitations',async(req,res)=>{
  const {proposalId,partnerId}=req.params,{email,role}=req.body??{};
  if(!uuid.test(proposalId)||!uuid.test(partnerId)||typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email.trim())||!['partner_admin','contributor','viewer'].includes(role))return res.status(400).json({error:'Enter a valid email and role.'});
  let c;try{c=await req.database.connect();await c.query('begin');
   const p=await c.query('select status from proposals where id=$1 for update',[proposalId]);
   if(!p.rowCount||!['draft','in_preparation'].includes(p.rows[0].status)){await c.query('rollback');return res.status(409).json({error:'Proposal is unavailable or read-only.'});}
   const allowed=await c.query("select 1 from proposal_memberships m join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.partner_id=$2 and m.user_id=$3 and m.status='active' and m.access_role in ('coordinator_manager','partner_admin') and cp.status='active'",[proposalId,partnerId,req.userId]);
   if(!allowed.rowCount){await c.query('rollback');return res.status(403).json({error:'Only the organization administrator can invite colleagues.'});}
   const key=email.trim().toLowerCase();
   const exists=await c.query("select 1 from proposal_memberships m join users u on u.id=m.user_id where m.proposal_id=$1 and u.email_key=$2 and m.status='active'",[proposalId,key]);
   if(exists.rowCount){await c.query('rollback');return res.status(409).json({error:'This account already has access to the proposal.'});}
   const id=randomUUID();
   await c.query("insert into consortium_invitations(id,proposal_id,partner_id,kind,recipient_email,recipient_email_key,granted_role,token_hash,invited_by_user_id,expires_at) values($1,$2,$3,'member',$4,$5,$6,$7,$8,now()+interval '7 days')",[id,proposalId,partnerId,email.trim(),key,role,createHash('sha256').update(randomBytes(32)).digest('hex'),req.userId]);
   await c.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id) values($1,$2,$3,'invitation.created','consortium_invitation',$4)",[randomUUID(),proposalId,req.userId,id]);await c.query('commit');res.status(201).json({ok:true});
  }catch(e){if(c)await c.query('rollback').catch(()=>{});if(e.code==='23505')return res.status(409).json({error:'A pending invitation already exists for this email.'});console.error('member invitation failed',e);res.status(500).json({error:'Could not invite colleague.'});}finally{c?.release();}
 });
 app.post('/api/member-invitations/:id/resolve',async(req,res)=>{
  if(!uuid.test(req.params.id)||!['accept','decline'].includes(req.body?.action))return res.status(400).json({error:'Invalid invitation.'});
  if(!req.accountEmail)return res.status(403).json({error:'Sign in with an email account.'});let c;
  try{c=await req.database.connect();await c.query('begin');const found=await c.query("select proposal_id from consortium_invitations where id=$1 and recipient_email_key=$2 and kind='member'",[req.params.id,req.accountEmail]);
   if(!found.rowCount){await c.query('rollback');return res.status(404).json({error:'Invitation not found.'});}
   const p=await c.query('select status from proposals where id=$1 for update',[found.rows[0].proposal_id]);const item=await c.query('select * from consortium_invitations where id=$1 for update',[req.params.id]);const i=item.rows[0];
   if(i.status!=='pending'||new Date(i.expires_at)<=new Date()||!['draft','in_preparation'].includes(p.rows[0].status)){await c.query('rollback');return res.status(409).json({error:'Invitation is no longer available.'});}
   const allowed=await c.query("select 1 from proposal_memberships m join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.partner_id=$2 and m.user_id=$3 and m.status='active' and m.access_role in ('coordinator_manager','partner_admin') and cp.status='active'",[i.proposal_id,i.partner_id,i.invited_by_user_id]);
   if(!allowed.rowCount){await c.query('rollback');return res.status(409).json({error:'Invitation is no longer valid.'});}
   if(req.body.action==='accept'){
    const existing=await c.query('select status from proposal_memberships where proposal_id=$1 and user_id=$2 for update',[i.proposal_id,req.userId]);
    if(existing.rows[0]?.status==='active'){await c.query('rollback');return res.status(409).json({error:'You already have access to this proposal.'});}
    await c.query("insert into proposal_memberships(id,proposal_id,partner_id,user_id,access_role,granted_by_user_id) values($1,$2,$3,$4,$5,$6) on conflict (proposal_id,user_id) do update set partner_id=excluded.partner_id,access_role=excluded.access_role,status='active',revoked_at=null,joined_at=now(),granted_by_user_id=excluded.granted_by_user_id,updated_at=now() where proposal_memberships.status='revoked'",[randomUUID(),i.proposal_id,i.partner_id,req.userId,i.granted_role,i.invited_by_user_id]);
   }
   const status=req.body.action==='accept'?'accepted':'declined';
   await c.query('update consortium_invitations set status=$1,accepted_by_user_id=$2,resolved_at=now(),updated_at=now() where id=$3',[status,status==='accepted'?req.userId:null,i.id]);
   await c.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id) values($1,$2,$3,$4,'consortium_invitation',$5)",[randomUUID(),i.proposal_id,req.userId,`invitation.${status}`,i.id]);await c.query('commit');res.json({ok:true});
  }catch(e){if(c)await c.query('rollback').catch(()=>{});console.error('member invitation resolution failed',e);res.status(500).json({error:'Could not resolve invitation.'});}finally{c?.release();}
 });
}
