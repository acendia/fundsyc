import { randomUUID } from "node:crypto";
import { canManageDocument, canChangeDocuments, canAddDocument, documentMemberSql } from "./document-permissions.mjs";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function addDocumentReviewRoutes(app) {
  const base="/api/proposals/:proposalId/documents/:documentId/versions/:versionId/reviews";
  async function change(req,res,create) {
    const {proposalId,documentId,versionId,reviewId}=req.params;
    if (![proposalId,documentId,versionId,...(reviewId?[reviewId]:[])].every(id=>uuid.test(id)))return res.status(404).json({error:"Review not found."});
    const {reviewerUserId,dueDate,instructions,status,response}=req.body??{};
    if(create){
      let validDate = dueDate == null || dueDate === "";
      if(typeof dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)){const date=new Date(dueDate);validDate=!isNaN(date.getTime())&&date.toISOString().slice(0,10)===dueDate;}
      if(!uuid.test(reviewerUserId??"")||!validDate||(instructions!=null&&typeof instructions!=="string"))return res.status(400).json({error:"Choose a reviewer and valid optional due date."});
    } else if(!['approved','changes_requested','cancelled'].includes(status)||(response!=null&&typeof response!=="string"))return res.status(400).json({error:"Choose a valid review outcome."});
    let c;
    try{
      c=await req.database.connect();await c.query('begin');
      const proposal=(await c.query('select status,coordinator_partner_id from proposals where id=$1 for update',[proposalId])).rows[0];
      const members=(await c.query(documentMemberSql,[proposalId])).rows;const actor=members.find(m=>m.user_id===req.userId);
      if(!actor||!proposal){await c.query('rollback');return res.status(403).json({error:"You do not have access to this proposal."});}
      if(!canChangeDocuments(proposal)){await c.query('rollback');return res.status(409).json({error:"This proposal is read-only."});}
      const doc=(await c.query("select d.owner_user_id,m.partner_id from documents d join proposal_memberships m on m.proposal_id=d.proposal_id and m.user_id=d.owner_user_id join document_versions v on v.document_id=d.id and v.proposal_id=d.proposal_id where d.id=$1 and d.proposal_id=$2 and d.status='active' and v.id=$3 for update of d",[documentId,proposalId,versionId])).rows[0];
      if(!doc){await c.query('rollback');return res.status(404).json({error:"Document version not found."});}
      const manager=canManageDocument(actor,{user_id:doc.owner_user_id,partner_id:doc.partner_id},proposal.coordinator_partner_id);
      let id=reviewId;
      if(create){
        if(!manager){await c.query('rollback');return res.status(403).json({error:"You cannot request a review for this document."});}
        const reviewer=members.find(m=>m.user_id===reviewerUserId);
        if(!canAddDocument(reviewer)||reviewerUserId===req.userId){await c.query('rollback');return res.status(400).json({error:"Choose another active member with a contributor or administrator role."});}
        const pending=await c.query("select 1 from document_reviews where version_id=$1 and status='pending'",[versionId]);
        if(pending.rowCount){await c.query('rollback');return res.status(409).json({error:"This version already has a pending review."});}
        id=randomUUID();await c.query('insert into document_reviews(id,proposal_id,version_id,requested_by_user_id,reviewer_user_id,due_date,instructions) values($1,$2,$3,$4,$5,$6,$7)',[id,proposalId,versionId,req.userId,reviewerUserId,dueDate||null,instructions?.trim()||null]);
      }else{
        const review=(await c.query('select status,reviewer_user_id from document_reviews where id=$1 and version_id=$2 and proposal_id=$3 for update',[id,versionId,proposalId])).rows[0];
        if(!review){await c.query('rollback');return res.status(404).json({error:"Review not found."});}
        if(review.status!=='pending'){await c.query('rollback');return res.status(409).json({error:"Review is already resolved."});}
        if(status==='cancelled'?!manager:!(review.reviewer_user_id===req.userId&&canAddDocument(actor))){await c.query('rollback');return res.status(403).json({error:"You cannot perform this review action."});}
        await c.query('update document_reviews set status=$1,response=$2,resolved_at=now(),updated_at=now() where id=$3',[status,status==='cancelled'?null:response?.trim()||null,id]);
      }
      const latest=(await c.query("select status from document_reviews where version_id=$1 and status<>'cancelled' order by created_at desc,id desc limit 1",[versionId])).rows[0];
      const state=!latest?'not_submitted':latest.status==='pending'?'in_review':latest.status;
      await c.query('update document_versions set review_status=$1 where id=$2',[state,versionId]);
      await c.query('update documents set updated_by_user_id=$1,updated_at=now() where id=$2',[req.userId,documentId]);
      await c.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id) values($1,$2,$3,$4,'document_review',$5)",[randomUUID(),proposalId,req.userId,create?'review.requested':`review.${status}`,id]);
      await c.query('commit');res.status(create?201:200).json({id});
    }catch(error){if(c)await c.query('rollback').catch(()=>{});console.error('review change failed',error);res.status(500).json({error:"Could not save review."});}finally{c?.release();}
  }
  app.post(base,(req,res)=>change(req,res,true));
  app.patch(`${base}/:reviewId`,(req,res)=>change(req,res,false));
}
