import { randomUUID } from "node:crypto";
import { canChangeDocuments, documentMemberSql } from "./document-permissions.mjs";

export function canManageCategories(actor, proposal) {
  return canChangeDocuments(proposal) && actor?.access_role === "coordinator_manager"
    && actor.partner_id === proposal.coordinator_partner_id;
}

export function addDocumentCategoryRoutes(app) {
  const base = "/api/proposals/:proposalId/documents/categories";
  async function change(req, res, removing) {
    const { proposalId, categoryId } = req.params;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(proposalId) || (removing && !uuid.test(categoryId))) return res.status(404).json({ error: "Category not found." });
    let c;
    try {
      c = await req.database.connect();
      await c.query("begin");
      const fail = async (status, error) => { await c.query("rollback"); return res.status(status).json({ error }); };
      const proposal = (await c.query("select status,coordinator_partner_id from proposals where id=$1 for update", [proposalId])).rows[0];
      const actor = (await c.query(documentMemberSql, [proposalId])).rows.find(m => m.user_id === req.userId);
      if (!proposal || !actor) return await fail(403, "You do not have access to this proposal.");
      if (!canManageCategories(actor, proposal)) return await fail(canChangeDocuments(proposal) ? 403 : 409, "Only the proposal coordinator can manage categories in an editable proposal.");
      const id = removing ? categoryId : randomUUID();
      if (removing) {
        const category = (await c.query("select value from document_categories where id=$1 and proposal_id=$2 and status='active' for update", [id, proposalId])).rows[0];
        if (!category) return await fail(404, "Category not found.");
        const count = (await c.query("select count(*)::int as n from documents where proposal_id=$1 and category=$2 and status='active'", [proposalId, category.value])).rows[0].n;
        if (count) return await fail(409, `This category contains ${count} active document${count === 1 ? "" : "s"}. Remove these documents yourself before removing the category. No documents have been removed.`);
        await c.query("update document_categories set status='removed',removed_at=now(),removed_by_user_id=$1 where id=$2 and proposal_id=$3", [req.userId, id, proposalId]);
      } else {
        const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
        if (!label || [...label].length > 80) return await fail(400, "Enter a category name between 1 and 80 characters.");
        await c.query("insert into document_categories(id,proposal_id,value,label,created_by_user_id) values($1,$2,$3,$4,$5)", [id, proposalId, id, label, req.userId]);
      }
      await c.query("insert into audit_events(id,proposal_id,actor_user_id,action,entity_type,entity_id) values($1,$2,$3,$4,'document_category',$5)", [randomUUID(), proposalId, req.userId, removing ? "document_category.removed" : "document_category.created", id]);
      await c.query("commit");
      res.status(removing ? 200 : 201).json({ id });
    } catch (error) {
      if (c) await c.query("rollback").catch(() => {});
      if (error.code === "23505") return res.status(409).json({ error: "A category with this name already exists." });
      if (error.code === "23514") return res.status(409).json({ error: "Remove the documents in this category first, then try again." });
      console.error("document category change failed", error);
      res.status(500).json({ error: "Could not save category." });
    } finally { c?.release(); }
  }
  app.post(base, (req, res) => change(req, res, false));
  app.delete(base + "/:categoryId", (req, res) => change(req, res, true));
}
