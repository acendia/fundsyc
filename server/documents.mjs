import multer from "multer";
import { maxDocumentBytes } from "./document-storage.mjs";
import { randomUUID } from "node:crypto";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories = ["proposal_drafts", "budget_finance", "legal_documents", "supporting_evidence"];
const memberSql = "select m.user_id, m.partner_id, m.access_role, u.display_name from proposal_memberships m join users u on u.id=m.user_id join consortium_partners cp on cp.id=m.partner_id and cp.proposal_id=m.proposal_id where m.proposal_id=$1 and m.status='active' and u.status='active' and cp.status='active'";
const editable = (actor, owner, coordinatorId) => actor && actor.access_role !== "viewer" && ((actor.access_role === "coordinator_manager" && actor.partner_id === coordinatorId) || actor.user_id === owner?.user_id || (actor.access_role === "partner_admin" && actor.partner_id === owner?.partner_id));
export function addDocumentRoutes(app, storage = null) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxDocumentBytes, files: 1, fields: 4, fieldSize: 16000 } }).single("file");
  const base = "/api/proposals/:proposalId/documents";
  app.get(base, async (req, res) => {
    if (!uuid.test(req.params.proposalId)) return res.status(404).json({error:"Proposal not found."});
    try {
      const members = (await req.database.query(memberSql, [req.params.proposalId])).rows;
      const actor = members.find(m => m.user_id === req.userId);
      if (!actor) return res.status(403).json({error:"You do not have access to this proposal."});
      const proposal = (await req.database.query("select title,status,coordinator_partner_id from proposals where id=$1", [req.params.proposalId])).rows[0];
      const docs = await req.database.query("select d.*, u.display_name as owner_name, a.display_name as added_by_name from documents d join users u on u.id=d.owner_user_id join users a on a.id=d.added_by_user_id where d.proposal_id=$1 and d.status='active' order by d.updated_at desc,d.id", [req.params.proposalId]);
      const versions = await req.database.query("select v.id,v.document_id,v.version_number,v.source_kind,v.file_name,v.size_bytes,v.external_url,v.version_note,v.review_status,v.created_at,u.display_name as added_by_name from document_versions v join documents d on d.id=v.document_id and d.proposal_id=v.proposal_id join users u on u.id=v.added_by_user_id where d.proposal_id=$1 and d.status='active' order by v.version_number desc", [req.params.proposalId]);
      const writable = ["draft","in_preparation"].includes(proposal.status);
      res.json({proposal, current_user_id:req.userId, can_add:writable && actor.access_role!=="viewer", owners:members.filter(m=>editable(actor,m,proposal.coordinator_partner_id)), documents:docs.rows.map(d=>({...d, can_edit:writable && editable(actor, members.find(m=>m.user_id===d.owner_user_id) ?? {user_id:d.owner_user_id},proposal.coordinator_partner_id), versions:versions.rows.filter(v=>v.document_id===d.id)}))});
    } catch(error) { console.error("document read failed",error); res.status(500).json({error:"Could not load documents."}); }
  });
  async function save(req,res,action) {
    const {proposalId,documentId}=req.params;
    if(!uuid.test(proposalId)||(documentId&&!uuid.test(documentId)))return res.status(404).json({error:"Document not found."});
    const {title,description,category,ownerUserId,url,versionNote}=req.body??{};
    const addingVersion = ["version_link", "version_upload"].includes(action);
    const creating = ["create", "upload"].includes(action);
    const uploading = ["upload", "version_upload"].includes(action);
    if (addingVersion && versionNote != null && typeof versionNote !== "string") return res.status(400).json({error:"Enter a valid version note."});
    if((creating || action === "update") && (typeof title!=="string"||!title.trim()||!categories.includes(category)||!uuid.test(ownerUserId??"")||(description!=null&&typeof description!=="string")))return res.status(400).json({error:"Enter a title, category and owner."});
    let link;
    if(action==="create" || action==="version_link") { try {link=new URL(url);if(link.protocol!=="https:"||link.username||link.password)throw Error();}catch{return res.status(400).json({error:"Enter a valid HTTPS link."});} }
    let fileType;
    if (uploading) {
      const types = { pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
      const extension = req.file?.originalname.split(".").pop().toLowerCase();
      fileType = types[extension];
      if (!storage) return res.status(503).json({ error: "Private file storage is not configured." });
      if (!fileType || !req.file?.size) return res.status(400).json({ error: "Choose a PDF, DOC, DOCX, XLS or XLSX file up to 10 MB." });
      const bytes = req.file.buffer;
      const valid = extension === "pdf" ? bytes.subarray(0,5).toString() === "%PDF-" : ["docx","xlsx"].includes(extension) ? bytes[0] === 0x50 && bytes[1] === 0x4b : bytes.subarray(0,8).toString("hex") === "d0cf11e0a1b11ae1";
      if (!valid) return res.status(400).json({ error: "The file contents do not match its extension." });
    }
    let c, uploadedPath, committed = false;
    try {
      c=await req.database.connect();await c.query("begin");
      const p=(await c.query("select status,coordinator_partner_id from proposals where id=$1 for update",[proposalId])).rows[0];
      const members=(await c.query(memberSql,[proposalId])).rows;
      const actor=members.find(m=>m.user_id===req.userId);
      if(!p||!actor){await c.query("rollback");return res.status(403).json({error:"You do not have access to this proposal."});}
      if(!["draft","in_preparation"].includes(p.status)){await c.query("rollback");return res.status(409).json({error:"This proposal is read-only."});}
      const owner=members.find(m=>m.user_id===ownerUserId);
      const id=documentId||randomUUID();
      if(!creating) {
        const doc=(await c.query("select owner_user_id from documents where id=$1 and proposal_id=$2 and status='active' for update",[id,proposalId])).rows[0];
        if(!doc){await c.query("rollback");return res.status(404).json({error:"Document not found."});}
        if(!editable(actor,members.find(m=>m.user_id===doc.owner_user_id)??{user_id:doc.owner_user_id},p.coordinator_partner_id)){await c.query("rollback");return res.status(403).json({error:"You cannot manage this document."});}
      }
      if((creating || action === "update") && (!owner||!editable(actor,owner,p.coordinator_partner_id))){await c.query("rollback");return res.status(403).json({error:"Choose an active owner you can manage."});}
      let versionNumber;
      if (creating || addingVersion) {
        if (creating) await c.query("insert into documents(id,proposal_id,title,description,category,owner_user_id,added_by_user_id,updated_by_user_id) values($1,$2,$3,$4,$5,$6,$7,$7)",[id,proposalId,title.trim(),description?.trim()||null,category,ownerUserId,req.userId]);
        // the proposal and document locks keep concurrent version numbers separate
        versionNumber = (await c.query("select coalesce(max(version_number),0)+1 as next from document_versions where document_id=$1 and proposal_id=$2", [id,proposalId])).rows[0].next;
        const versionId = randomUUID();
        const note = addingVersion ? versionNote?.trim() || null : null;
        if (uploading) {
          const path = `${proposalId}/${id}/${versionId}`;
          uploadedPath = path;
          await storage.upload(path, req.file.buffer, fileType);
          await c.query("insert into document_versions(id,proposal_id,document_id,version_number,source_kind,storage_key,file_name,content_type,size_bytes,added_by_user_id,version_note) values($1,$2,$3,$4,'uploaded_file',$5,$6,$7,$8,$9,$10)", [versionId,proposalId,id,versionNumber,path,req.file.originalname,fileType,req.file.size,req.userId,note]);
        } else await c.query("insert into document_versions(id,proposal_id,document_id,version_number,source_kind,external_url,added_by_user_id,version_note) values($1,$2,$3,$4,'external_link',$5,$6,$7)",[versionId,proposalId,id,versionNumber,link.href,req.userId,note]);
        if (addingVersion) await c.query("update documents set updated_by_user_id=$1,updated_at=now() where id=$2 and proposal_id=$3",[req.userId,id,proposalId]);
      } else if(action==="update") await c.query("update documents set title=$1,description=$2,category=$3,owner_user_id=$4,updated_by_user_id=$5,updated_at=now() where id=$6 and proposal_id=$7",[title.trim(),description?.trim()||null,category,ownerUserId,req.userId,id,proposalId]);
      else await c.query("update documents set status='removed',removed_at=now(),removed_by_user_id=$1,updated_by_user_id=$1,updated_at=now() where id=$2 and proposal_id=$3",[req.userId,id,proposalId]);
      await c.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id) values($1,$2,$3,$4,'document',$5)",[randomUUID(),proposalId,req.userId,`document.${{create:'created',upload:'created',version_link:'version_added',version_upload:'version_added',update:'updated',remove:'removed'}[action]}`,id]);
      await c.query("commit");committed = true;res.status(creating || addingVersion ? 201 : 200).json({id,versionNumber});
    } catch(error){if(c)await c.query("rollback").catch(()=>{});console.error("document save failed",error);res.status(500).json({error:"Could not save document."});}finally{c?.release();if (uploadedPath && !committed) {
      try {
        const saved = await req.database.query("select 1 from document_versions where storage_key=$1", [uploadedPath]);
        if (!saved.rowCount) await storage.discard(uploadedPath);
      } catch (error) { console.error("failed upload cleanup", error); }
    }}
  }
  app.post(`${base}/upload`, (req,res) => upload(req,res,(error) => {
    if (error) return res.status(400).json({error: error.code === "LIMIT_FILE_SIZE" ? "The file must be 10 MB or smaller." : "Could not read the upload. Choose one file."});
    return save(req,res,"upload");
  }));
  app.post(`${base}/:documentId/versions/link`,(req,res)=>save(req,res,"version_link"));
  app.post(`${base}/:documentId/versions/upload`,(req,res)=>upload(req,res,(error)=>{
    if(error) return res.status(400).json({error:error.code === "LIMIT_FILE_SIZE" ? "The file must be 10 MB or smaller." : "Could not read the upload. Choose one file."});
    return save(req,res,"version_upload");
  }));
  app.get(`${base}/:documentId/versions/:versionId/download`, async (req,res) => {
    const {proposalId,documentId,versionId} = req.params;
    if (![proposalId,documentId,versionId].every(id => uuid.test(id))) return res.status(404).json({error:"File not found."});
    try {
      const members=(await req.database.query(memberSql,[proposalId])).rows;
      if (!members.some(m => m.user_id === req.userId)) return res.status(403).json({error:"You do not have access to this proposal."});
      const version=(await req.database.query("select v.storage_key,v.file_name,v.content_type from document_versions v join documents d on d.id=v.document_id and d.proposal_id=v.proposal_id where v.id=$1 and v.document_id=$2 and v.proposal_id=$3 and v.source_kind='uploaded_file' and d.status='active'",[versionId,documentId,proposalId])).rows[0];
      if (!version) return res.status(404).json({error:"File not found."});
      if (!storage) return res.status(503).json({error:"Private file storage is not configured."});
      const blob = await storage.download(version.storage_key);
      res.set({"Content-Type":version.content_type,"Content-Disposition":`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(version.file_name).replace(/'/g,"%27")}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});
      res.send(Buffer.from(await blob.arrayBuffer()));
    } catch(error) { console.error("document download failed",error); res.status(500).json({error:"Could not download the file."}); }
  });
  app.post(base,(req,res)=>save(req,res,"create"));
  app.patch(`${base}/:documentId`,(req,res)=>save(req,res,"update"));
  app.delete(`${base}/:documentId`,(req,res)=>save(req,res,"remove"));
}
