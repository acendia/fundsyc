CREATE TABLE users (
 id uuid PRIMARY KEY, auth_subject text NOT NULL UNIQUE, email text NOT NULL,
 email_key text NOT NULL UNIQUE, display_name text NOT NULL, email_verified_at timestamptz,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organizations (
 id uuid PRIMARY KEY, legal_name text NOT NULL CHECK(length(trim(legal_name)) > 0), short_name text,
 organization_type text NOT NULL CHECK(organization_type IN ('university','research_institute','company','public_body','nonprofit','other')),
 country_code char(2) NOT NULL CHECK(country_code ~ '^[A-Z]{2}$'), city text, website_url text,
 external_identifier_scheme text, external_identifier_value text,
 CHECK((external_identifier_scheme IS NULL) = (external_identifier_value IS NULL)),
 UNIQUE(external_identifier_scheme,external_identifier_value),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE proposals (
 id uuid PRIMARY KEY, title text NOT NULL CHECK(length(trim(title)) > 0), acronym text,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_preparation','submitted','archived')),
 coordinator_partner_id uuid NOT NULL, created_by_user_id uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE consortium_partners (
 id uuid PRIMARY KEY, proposal_id uuid NOT NULL REFERENCES proposals, organization_id uuid NOT NULL REFERENCES organizations,
 status text NOT NULL CHECK(status IN ('invited','active','withdrawn','removed')), primary_contact_id uuid,
 joined_at timestamptz, ended_at timestamptz,
 UNIQUE(proposal_id,organization_id), UNIQUE(proposal_id,id),
 CHECK(status <> 'active' OR (primary_contact_id IS NOT NULL AND joined_at IS NOT NULL)),
 CHECK((status IN ('withdrawn','removed')) = (ended_at IS NOT NULL)),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE proposals ADD CONSTRAINT proposal_coordinator_fk FOREIGN KEY(id,coordinator_partner_id)
 REFERENCES consortium_partners(proposal_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE partner_contacts (
 id uuid PRIMARY KEY, proposal_id uuid NOT NULL, partner_id uuid NOT NULL,
 full_name text NOT NULL, email text NOT NULL, email_key text NOT NULL, job_title text, phone text,
 user_id uuid REFERENCES users, UNIQUE(partner_id,id),
 FOREIGN KEY(proposal_id,partner_id) REFERENCES consortium_partners(proposal_id,id),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')), removed_at timestamptz, CHECK((status='removed') = (removed_at IS NOT NULL)), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE consortium_partners ADD CONSTRAINT partner_primary_contact_fk FOREIGN KEY(id,primary_contact_id)
 REFERENCES partner_contacts(partner_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE proposal_memberships (
 id uuid PRIMARY KEY, proposal_id uuid NOT NULL, partner_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users,
 access_role text NOT NULL CHECK(access_role IN ('coordinator_manager','partner_admin','contributor','viewer')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 joined_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, granted_by_user_id uuid NOT NULL REFERENCES users,
 UNIQUE(proposal_id,user_id), FOREIGN KEY(proposal_id,partner_id) REFERENCES consortium_partners(proposal_id,id),
 CHECK((status='revoked') = (revoked_at IS NOT NULL)),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE responsibilities (
 id uuid PRIMARY KEY, proposal_id uuid NOT NULL REFERENCES proposals, title text NOT NULL, description text,
 sort_order integer NOT NULL DEFAULT 0, UNIQUE(proposal_id,id),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')), removed_at timestamptz, CHECK((status='removed') = (removed_at IS NOT NULL)), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE partner_responsibilities (
 proposal_id uuid NOT NULL, partner_id uuid NOT NULL, responsibility_id uuid NOT NULL, sort_order integer NOT NULL DEFAULT 0,
 PRIMARY KEY(partner_id,responsibility_id),
 FOREIGN KEY(proposal_id,partner_id) REFERENCES consortium_partners(proposal_id,id),
 FOREIGN KEY(proposal_id,responsibility_id) REFERENCES responsibilities(proposal_id,id), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')), removed_at timestamptz, CHECK((status='removed') = (removed_at IS NOT NULL)), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE consortium_invitations (
 id uuid PRIMARY KEY, proposal_id uuid NOT NULL, partner_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('organization','member')), recipient_email text NOT NULL, recipient_email_key text NOT NULL,
 recipient_name text, granted_role text NOT NULL CHECK(granted_role IN ('partner_admin','contributor','viewer')),
 token_hash text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','revoked','expired')),
 invited_by_user_id uuid NOT NULL REFERENCES users, sent_at timestamptz, expires_at timestamptz NOT NULL,
 resolved_at timestamptz, accepted_by_user_id uuid REFERENCES users,
 CHECK(kind <> 'organization' OR granted_role='partner_admin'), CHECK(expires_at > created_at),
 CHECK((status='pending') = (resolved_at IS NULL)), CHECK((status='accepted') = (accepted_by_user_id IS NOT NULL)),
 FOREIGN KEY(proposal_id,partner_id) REFERENCES consortium_partners(proposal_id,id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pending_org_invite ON consortium_invitations(partner_id) WHERE status='pending' AND kind='organization';
CREATE UNIQUE INDEX pending_member_invite ON consortium_invitations(partner_id,recipient_email_key) WHERE status='pending' AND kind='member';
CREATE TABLE audit_events (
 id uuid PRIMARY KEY, proposal_id uuid NOT NULL REFERENCES proposals, actor_user_id uuid REFERENCES users,
 action text NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memberships_user ON proposal_memberships(user_id,proposal_id);
CREATE INDEX partners_proposal ON consortium_partners(proposal_id,status);
CREATE INDEX contacts_partner ON partner_contacts(proposal_id,partner_id);
CREATE INDEX assignments_responsibility ON partner_responsibilities(proposal_id,responsibility_id);
CREATE INDEX invitations_proposal ON consortium_invitations(proposal_id,status,expires_at);
CREATE INDEX audit_proposal ON audit_events(proposal_id,created_at);

CREATE UNIQUE INDEX active_contact_email ON partner_contacts(partner_id,email_key) WHERE status='active';

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
 review_status text NOT NULL DEFAULT 'not_submitted' CHECK(review_status='not_submitted'),
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
