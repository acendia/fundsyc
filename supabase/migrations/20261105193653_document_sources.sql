BEGIN;
CREATE TABLE documents (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL REFERENCES proposals,
 title text NOT NULL CHECK(length(trim(title)) > 0),
 description text,
 category text NOT NULL CHECK(category IN ('proposal_drafts','budget_finance','legal_documents','supporting_evidence')),
 owner_user_id uuid NOT NULL REFERENCES users,
 added_by_user_id uuid NOT NULL REFERENCES users,
 updated_by_user_id uuid NOT NULL REFERENCES users,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(proposal_id,id),
 FOREIGN KEY(proposal_id,owner_user_id) REFERENCES proposal_memberships(proposal_id,user_id),
 CHECK((status='removed') = (removed_at IS NOT NULL)),
 CHECK((status='removed') = (removed_by_user_id IS NOT NULL))
);

CREATE TABLE document_versions (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL,
 document_id uuid NOT NULL,
 version_number integer NOT NULL CHECK(version_number > 0),
 source_kind text NOT NULL CHECK(source_kind IN ('uploaded_file','external_link')),
 storage_key text,
 file_name text,
 content_type text,
 size_bytes bigint,
 external_url text,
 version_note text,
 added_by_user_id uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(proposal_id,document_id) REFERENCES documents(proposal_id,id),
 UNIQUE(document_id,version_number),
 CHECK(
  (source_kind='uploaded_file' AND storage_key IS NOT NULL AND length(trim(storage_key)) > 0
   AND file_name IS NOT NULL AND length(trim(file_name)) > 0
   AND content_type IS NOT NULL AND length(trim(content_type)) > 0
   AND size_bytes IS NOT NULL AND size_bytes >= 0 AND external_url IS NULL)
  OR
  (source_kind='external_link' AND external_url IS NOT NULL
   AND external_url ~ '^https://[^[:space:]/?#]+[^[:space:]]*$'
   AND storage_key IS NULL AND file_name IS NULL AND content_type IS NULL AND size_bytes IS NULL)
 )
);

CREATE UNIQUE INDEX document_file_key ON document_versions(storage_key) WHERE source_kind='uploaded_file';
CREATE INDEX documents_proposal ON documents(proposal_id,status);

-- check the owner when first added or reassigned, keep history when they later leave
CREATE FUNCTION check_document_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.proposal_memberships m
  JOIN public.users u ON u.id=m.user_id
  JOIN public.consortium_partners cp ON cp.id=m.partner_id AND cp.proposal_id=m.proposal_id
  WHERE m.proposal_id=NEW.proposal_id AND m.user_id=NEW.owner_user_id
    AND m.status='active' AND u.status='active' AND cp.status='active'
 ) THEN
  RAISE EXCEPTION 'Document owner must be an active member of this proposal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER document_owner_check BEFORE INSERT OR UPDATE OF proposal_id,owner_user_id ON documents
FOR EACH ROW EXECUTE FUNCTION check_document_owner();

-- the api owns access checks, no direct browser access to these tables
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

COMMIT;
