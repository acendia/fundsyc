BEGIN;
SET LOCAL lock_timeout = '10s';
-- keep proposal creation and document saves out of the backfill window
LOCK TABLE proposals, documents IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE document_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 proposal_id uuid NOT NULL REFERENCES proposals,
 value text NOT NULL,
 label text NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 80),
 created_by_user_id uuid REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 UNIQUE(proposal_id,value),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX document_categories_label ON document_categories(proposal_id,lower(trim(label))) WHERE status='active';

-- existing values stay the same, including categories on removed documents
INSERT INTO document_categories(proposal_id,value,label)
SELECT p.id,d.value,d.label FROM proposals p CROSS JOIN (VALUES
 ('proposal_drafts','Proposal drafts'),('budget_finance','Budget & finance'),
 ('legal_documents','Legal documents'),('supporting_evidence','Supporting evidence')
) AS d(value,label);
ALTER TABLE documents DROP CONSTRAINT documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_fkey FOREIGN KEY(proposal_id,category) REFERENCES document_categories(proposal_id,value);
CREATE INDEX documents_category ON documents(proposal_id,category) WHERE status='active';

-- new proposals get the defaults too
CREATE FUNCTION seed_document_categories() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 INSERT INTO public.document_categories(proposal_id,value,label) VALUES
 (NEW.id,'proposal_drafts','Proposal drafts'),(NEW.id,'budget_finance','Budget & finance'),
 (NEW.id,'legal_documents','Legal documents'),(NEW.id,'supporting_evidence','Supporting evidence');
 RETURN NEW;
END;
$$;
CREATE TRIGGER proposal_document_categories AFTER INSERT ON proposals
FOR EACH ROW EXECUTE FUNCTION seed_document_categories();

-- lock the category while assigning it, so removal cannot race a document save
CREATE FUNCTION check_document_category() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.status='active' THEN
  PERFORM 1 FROM public.document_categories
   WHERE proposal_id=NEW.proposal_id AND value=NEW.category AND status='active' FOR SHARE;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Choose an active document category' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER document_category_check BEFORE INSERT OR UPDATE OF proposal_id,category,status ON documents
FOR EACH ROW EXECUTE FUNCTION check_document_category();

CREATE FUNCTION check_category_removal() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.status='removed' AND EXISTS (
  SELECT 1 FROM public.documents WHERE proposal_id=OLD.proposal_id AND category=OLD.value AND status='active'
 ) THEN
  RAISE EXCEPTION 'Remove the documents in this category first' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER document_category_removal BEFORE UPDATE OF status ON document_categories
FOR EACH ROW EXECUTE FUNCTION check_category_removal();
ALTER TABLE document_categories ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE client_role text;
BEGIN
 FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON TABLE document_categories FROM %I',client_role);
 END LOOP;
END;
$$;
COMMIT;
