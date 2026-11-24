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
CREATE INDEX audit_task_history ON audit_events(proposal_id,entity_id,created_at DESC,id DESC) WHERE entity_type='task';

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

ALTER TABLE document_versions DROP CONSTRAINT document_versions_review_status_check;
ALTER TABLE document_versions ADD CHECK(review_status IN ('not_submitted','in_review','approved','changes_requested'));
ALTER TABLE document_versions ADD UNIQUE(proposal_id,id);
CREATE TABLE document_reviews (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL REFERENCES proposals,
 version_id uuid NOT NULL,
 requested_by_user_id uuid NOT NULL REFERENCES users,
 reviewer_user_id uuid NOT NULL REFERENCES users,
 due_date date,
 instructions text,
 response text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','changes_requested','cancelled')),
 resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(proposal_id,version_id) REFERENCES document_versions(proposal_id,id),
 FOREIGN KEY(proposal_id,reviewer_user_id) REFERENCES proposal_memberships(proposal_id,user_id),
 CHECK(requested_by_user_id <> reviewer_user_id),
 CHECK((status='pending') = (resolved_at IS NULL))
);
CREATE UNIQUE INDEX pending_document_review ON document_reviews(version_id) WHERE status='pending';
CREATE INDEX reviews_proposal ON document_reviews(proposal_id,reviewer_user_id,status);
ALTER TABLE document_reviews ENABLE ROW LEVEL SECURITY;

-- document access goes through the api
DO $$
DECLARE client_role text;
BEGIN
 FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
  EXECUTE format('REVOKE ALL ON TABLE documents, document_versions, document_reviews FROM %I', client_role);
 END LOOP;
END;
$$;

ALTER TABLE proposal_memberships ADD CONSTRAINT memberships_partner_user UNIQUE(proposal_id,partner_id,user_id);

CREATE TABLE tasks (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL REFERENCES proposals,
 partner_id uuid NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) > 0),
 description text,
 progress text NOT NULL DEFAULT 'todo' CHECK(progress IN ('todo','in_progress','in_review','completed')),
 priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
 assignee_user_id uuid,
 assigned_by_user_id uuid REFERENCES users,
 assigned_at timestamptz,
 due_date date,
 created_by_user_id uuid NOT NULL REFERENCES users,
 updated_by_user_id uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 UNIQUE(proposal_id,id),
 FOREIGN KEY(proposal_id,partner_id) REFERENCES consortium_partners(proposal_id,id),
 FOREIGN KEY(proposal_id,partner_id,assignee_user_id) REFERENCES proposal_memberships(proposal_id,partner_id,user_id),
 CHECK((assignee_user_id IS NULL AND assigned_by_user_id IS NULL AND assigned_at IS NULL)
    OR (assignee_user_id IS NOT NULL AND assigned_by_user_id IS NOT NULL AND assigned_at IS NOT NULL)),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);

-- check new assignments, keep existing tasks when someone leaves
CREATE FUNCTION check_task_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.consortium_partners
   WHERE id=NEW.partner_id AND proposal_id=NEW.proposal_id AND status='active') THEN
  RAISE EXCEPTION 'Task partner must be active in this proposal' USING ERRCODE='23514';
 END IF;
 IF NEW.assignee_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.proposal_memberships m JOIN public.users u ON u.id=m.user_id
  WHERE m.proposal_id=NEW.proposal_id AND m.partner_id=NEW.partner_id
   AND m.user_id=NEW.assignee_user_id AND m.status='active' AND u.status='active'
 ) THEN
  RAISE EXCEPTION 'Task assignee must be an active member of this partner and proposal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER task_assignment_check BEFORE INSERT OR UPDATE OF proposal_id,partner_id,assignee_user_id ON tasks
FOR EACH ROW EXECUTE FUNCTION check_task_assignment();

CREATE TABLE task_comments (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL,
 task_id uuid NOT NULL,
 author_user_id uuid NOT NULL,
 body text NOT NULL CHECK(length(trim(body)) > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 FOREIGN KEY(proposal_id,task_id) REFERENCES tasks(proposal_id,id),
 FOREIGN KEY(proposal_id,author_user_id) REFERENCES proposal_memberships(proposal_id,user_id),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);
CREATE INDEX tasks_proposal ON tasks(proposal_id,status,progress);
CREATE INDEX tasks_assignee ON tasks(proposal_id,assignee_user_id,status);
CREATE INDEX comments_task ON task_comments(proposal_id,task_id,status,created_at);

-- task access goes through the api
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE client_role text;
BEGIN
 FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON TABLE tasks, task_comments FROM %I', client_role);
 END LOOP;
END;
$$;

CREATE TABLE schedule_workstreams (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL REFERENCES proposals,
 lead_partner_id uuid NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) > 0),
 description text,
 start_date date NOT NULL CHECK(isfinite(start_date)),
 end_date date NOT NULL CHECK(isfinite(end_date)),
 CHECK(end_date >= start_date),
 progress text NOT NULL DEFAULT 'planned' CHECK(progress IN ('planned','in_progress','at_risk','completed')),
 FOREIGN KEY(proposal_id,lead_partner_id) REFERENCES consortium_partners(proposal_id,id),
 created_by_user_id uuid NOT NULL REFERENCES users,
 updated_by_user_id uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 UNIQUE(proposal_id,id),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);

CREATE TABLE schedule_milestones (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL REFERENCES proposals,
 lead_partner_id uuid NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) > 0),
 description text,
 due_date date NOT NULL CHECK(isfinite(due_date)),
 progress text NOT NULL DEFAULT 'planned' CHECK(progress IN ('planned','in_progress','at_risk','completed')),
 FOREIGN KEY(proposal_id,lead_partner_id) REFERENCES consortium_partners(proposal_id,id),
 created_by_user_id uuid NOT NULL REFERENCES users,
 updated_by_user_id uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 UNIQUE(proposal_id,id),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);

CREATE TABLE schedule_events (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL REFERENCES proposals,
 partner_id uuid NOT NULL,
 organizer_user_id uuid NOT NULL,
 workstream_id uuid,
 title text NOT NULL CHECK(length(trim(title)) > 0),
 event_type text NOT NULL CHECK(event_type IN ('meeting','deadline','reminder')),
 event_date date NOT NULL CHECK(isfinite(event_date)),
 all_day boolean NOT NULL DEFAULT true,
 starts_at timestamptz,
 ends_at timestamptz,
 time_zone text,
 notes text,
 FOREIGN KEY(proposal_id,partner_id) REFERENCES consortium_partners(proposal_id,id),
 FOREIGN KEY(proposal_id,partner_id,organizer_user_id) REFERENCES proposal_memberships(proposal_id,partner_id,user_id),
 FOREIGN KEY(proposal_id,workstream_id) REFERENCES schedule_workstreams(proposal_id,id),
 CHECK(
  (all_day AND starts_at IS NULL AND ends_at IS NULL AND time_zone IS NULL)
  OR
  (NOT all_day AND starts_at IS NOT NULL AND isfinite(starts_at)
   AND time_zone IS NOT NULL AND length(trim(time_zone)) > 0
   AND (ends_at IS NULL OR (isfinite(ends_at) AND ends_at > starts_at)))
 ),
 created_by_user_id uuid NOT NULL REFERENCES users,
 updated_by_user_id uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 UNIQUE(proposal_id,id),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);

-- check new lead assignments, keep records when a partner later leaves
CREATE FUNCTION check_schedule_lead() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.consortium_partners
  WHERE id=NEW.lead_partner_id AND proposal_id=NEW.proposal_id AND status='active'
 ) THEN
  RAISE EXCEPTION 'Schedule lead partner must be active in this proposal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER schedule_workstream_lead_check
 BEFORE INSERT OR UPDATE OF proposal_id,lead_partner_id ON schedule_workstreams
 FOR EACH ROW EXECUTE FUNCTION check_schedule_lead();
CREATE TRIGGER schedule_milestone_lead_check
 BEFORE INSERT OR UPDATE OF proposal_id,lead_partner_id ON schedule_milestones
 FOR EACH ROW EXECUTE FUNCTION check_schedule_lead();

-- only validate assignments when they are first made or changed
CREATE FUNCTION check_schedule_event_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.proposal_memberships m
  JOIN public.users u ON u.id=m.user_id
  JOIN public.consortium_partners cp ON cp.id=m.partner_id AND cp.proposal_id=m.proposal_id
  WHERE m.proposal_id=NEW.proposal_id AND m.partner_id=NEW.partner_id
   AND m.user_id=NEW.organizer_user_id AND m.status='active'
   AND u.status='active' AND cp.status='active'
 ) THEN
  RAISE EXCEPTION 'Event organizer must be an active member of this partner and proposal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER schedule_event_assignment_check
 BEFORE INSERT OR UPDATE OF proposal_id,partner_id,organizer_user_id ON schedule_events
 FOR EACH ROW EXECUTE FUNCTION check_schedule_event_assignment();

CREATE FUNCTION check_schedule_event_workstream() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.workstream_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.schedule_workstreams
  WHERE id=NEW.workstream_id AND proposal_id=NEW.proposal_id AND status='active'
 ) THEN
  RAISE EXCEPTION 'Event workstream must be active in this proposal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER schedule_event_workstream_check
 BEFORE INSERT OR UPDATE OF proposal_id,workstream_id ON schedule_events
 FOR EACH ROW EXECUTE FUNCTION check_schedule_event_workstream();

-- timestamptz keeps the instant; the named zone determines the event's local date
CREATE FUNCTION check_schedule_event_time() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NOT NEW.all_day THEN
  IF NEW.time_zone IS NULL OR NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=NEW.time_zone
    AND (name='UTC' OR name ~ '^[A-Za-z_]+/[A-Za-z_]+(/[A-Za-z_]+)?$')
  ) THEN
   RAISE EXCEPTION 'Choose a named event time zone' USING ERRCODE='23514';
  END IF;
  IF (NEW.starts_at AT TIME ZONE NEW.time_zone)::date IS DISTINCT FROM NEW.event_date
   OR (NEW.ends_at IS NOT NULL AND (NEW.ends_at AT TIME ZONE NEW.time_zone)::date <> NEW.event_date) THEN
   RAISE EXCEPTION 'Event times must fall on the selected date in its time zone' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER schedule_event_time_check
 BEFORE INSERT OR UPDATE OF event_date,all_day,starts_at,ends_at,time_zone ON schedule_events
 FOR EACH ROW EXECUTE FUNCTION check_schedule_event_time();

CREATE INDEX schedule_workstreams_dates ON schedule_workstreams(proposal_id,status,start_date,end_date);
CREATE INDEX schedule_workstreams_partner ON schedule_workstreams(proposal_id,lead_partner_id);
CREATE INDEX schedule_milestones_dates ON schedule_milestones(proposal_id,status,due_date);
CREATE INDEX schedule_milestones_partner ON schedule_milestones(proposal_id,lead_partner_id);
CREATE INDEX schedule_events_dates ON schedule_events(proposal_id,status,event_date);
CREATE INDEX schedule_events_starts ON schedule_events(proposal_id,starts_at) WHERE status='active' AND NOT all_day;
CREATE INDEX schedule_events_organizer ON schedule_events(proposal_id,partner_id,organizer_user_id);
CREATE INDEX schedule_events_workstream ON schedule_events(proposal_id,workstream_id);

-- schedule access goes through the api
ALTER TABLE schedule_workstreams ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_events ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE client_role text;
BEGIN
 FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON TABLE schedule_workstreams, schedule_milestones, schedule_events FROM %I', client_role);
 END LOOP;
END;
$$;

ALTER TABLE tasks ADD COLUMN workstream_id uuid;
ALTER TABLE tasks ADD CONSTRAINT task_workstream_fk
 FOREIGN KEY(proposal_id,workstream_id) REFERENCES schedule_workstreams(proposal_id,id);
CREATE INDEX tasks_workstream ON tasks(proposal_id,workstream_id,status);

-- check new links, keep historical links when a workstream is later removed
CREATE FUNCTION check_task_workstream() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.workstream_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.schedule_workstreams
  WHERE id=NEW.workstream_id AND proposal_id=NEW.proposal_id AND status='active'
 ) THEN
  RAISE EXCEPTION 'Task workstream must be active in this proposal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER task_workstream_check
 BEFORE INSERT OR UPDATE OF proposal_id,workstream_id ON tasks
 FOR EACH ROW EXECUTE FUNCTION check_task_workstream();

-- no membership foreign key: rejoining moves a membership to another partner, the trigger checks the active one
CREATE TABLE task_assignees (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL,
 task_id uuid NOT NULL,
 partner_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users,
 assigned_by_user_id uuid NOT NULL REFERENCES users,
 assigned_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 FOREIGN KEY(proposal_id,task_id) REFERENCES tasks(proposal_id,id),
 FOREIGN KEY(proposal_id,partner_id) REFERENCES consortium_partners(proposal_id,id),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX task_assignees_active ON task_assignees(task_id,user_id) WHERE status='active';
CREATE INDEX task_assignees_task ON task_assignees(proposal_id,task_id,status);
CREATE INDEX task_assignees_user ON task_assignees(proposal_id,user_id,status);

-- task access goes through the api
ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE client_role text;
BEGIN
 FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON TABLE task_assignees FROM %I', client_role);
 END LOOP;
END;
$$;

-- check new assignments only, keep history when someone leaves
CREATE FUNCTION check_task_assignee() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.status <> 'active' THEN
  RETURN NEW;
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.tasks
  WHERE id=NEW.task_id AND proposal_id=NEW.proposal_id AND partner_id=NEW.partner_id
 ) THEN
  RAISE EXCEPTION 'Task assignee must belong to the task partner' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.consortium_partners
   WHERE id=NEW.partner_id AND proposal_id=NEW.proposal_id AND status='active') THEN
  RAISE EXCEPTION 'Task partner must be active in this proposal' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.proposal_memberships m JOIN public.users u ON u.id=m.user_id
  WHERE m.proposal_id=NEW.proposal_id AND m.partner_id=NEW.partner_id
   AND m.user_id=NEW.user_id AND m.status='active' AND u.status='active'
 ) THEN
  RAISE EXCEPTION 'Task assignee must be an active member of this partner and proposal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER task_assignee_check BEFORE INSERT OR UPDATE OF proposal_id,task_id,partner_id,user_id,status ON task_assignees
FOR EACH ROW EXECUTE FUNCTION check_task_assignee();

-- no membership foreign key: removed memberships must not block rejoining
-- the check_discussion_author trigger validates new and changed authors instead
CREATE TABLE discussions (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL REFERENCES proposals,
 partner_id uuid NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users,
 title text NOT NULL CHECK(length(trim(title)) > 0 AND length(title) <= 200),
 body text NOT NULL CHECK(length(trim(body)) > 0),
 -- one optional link to an item in the same proposal, checked by check_discussion_link
 linked_kind text CHECK(linked_kind IN ('task','event','workstream','milestone')),
 linked_id uuid,
 CHECK((linked_kind IS NULL) = (linked_id IS NULL)),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by_user_id uuid NOT NULL REFERENCES users,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 UNIQUE(proposal_id,id),
 FOREIGN KEY(proposal_id,partner_id) REFERENCES consortium_partners(proposal_id,id),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);

CREATE TABLE discussion_replies (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL,
 discussion_id uuid NOT NULL,
 partner_id uuid NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users,
 body text NOT NULL CHECK(length(trim(body)) > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by_user_id uuid NOT NULL REFERENCES users,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 FOREIGN KEY(proposal_id,discussion_id) REFERENCES discussions(proposal_id,id),
 FOREIGN KEY(proposal_id,partner_id) REFERENCES consortium_partners(proposal_id,id),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);
CREATE INDEX discussions_proposal ON discussions(proposal_id,status);
CREATE INDEX discussions_link ON discussions(linked_kind,linked_id) WHERE status='active' AND linked_kind IS NOT NULL;
CREATE INDEX discussion_replies_discussion ON discussion_replies(discussion_id,status);

-- discussion access goes through the api
ALTER TABLE discussions ENABLE ROW LEVEL SECURITY;
ALTER TABLE discussion_replies ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE client_role text;
BEGIN
 FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON TABLE discussions, discussion_replies FROM %I', client_role);
 END LOOP;
END;
$$;

-- check new and changed authors only, keep posts when someone leaves
CREATE FUNCTION check_discussion_author() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.proposal_memberships m
  JOIN public.users u ON u.id=m.user_id
  JOIN public.consortium_partners cp ON cp.id=m.partner_id AND cp.proposal_id=m.proposal_id
  WHERE m.proposal_id=NEW.proposal_id AND m.partner_id=NEW.partner_id
   AND m.user_id=NEW.created_by_user_id AND m.status='active'
   AND u.status='active' AND cp.status='active'
 ) THEN
  RAISE EXCEPTION 'Discussion author must be an active member of this partner and proposal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER discussion_author_check BEFORE INSERT OR UPDATE OF proposal_id,partner_id,created_by_user_id ON discussions
FOR EACH ROW EXECUTE FUNCTION check_discussion_author();
CREATE TRIGGER discussion_reply_author_check BEFORE INSERT OR UPDATE OF proposal_id,partner_id,created_by_user_id ON discussion_replies
FOR EACH ROW EXECUTE FUNCTION check_discussion_author();

-- check new links only, keep historical links when the item is later removed
CREATE FUNCTION check_discussion_link() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE ok boolean;
BEGIN
 IF NEW.linked_kind IS NULL THEN
  RETURN NEW;
 END IF;
 IF NEW.linked_kind='task' THEN
  ok := EXISTS (SELECT 1 FROM public.tasks
   WHERE id=NEW.linked_id AND proposal_id=NEW.proposal_id AND status='active');
 ELSIF NEW.linked_kind='event' THEN
  ok := EXISTS (SELECT 1 FROM public.schedule_events
   WHERE id=NEW.linked_id AND proposal_id=NEW.proposal_id AND status='active');
 ELSIF NEW.linked_kind='workstream' THEN
  ok := EXISTS (SELECT 1 FROM public.schedule_workstreams
   WHERE id=NEW.linked_id AND proposal_id=NEW.proposal_id AND status='active');
 ELSIF NEW.linked_kind='milestone' THEN
  ok := EXISTS (SELECT 1 FROM public.schedule_milestones
   WHERE id=NEW.linked_id AND proposal_id=NEW.proposal_id AND status='active');
 END IF;
 IF NOT coalesce(ok, false) THEN
  RAISE EXCEPTION 'Discussion link must be an active item in this proposal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER discussion_link_check BEFORE INSERT OR UPDATE OF proposal_id,linked_kind,linked_id ON discussions
FOR EACH ROW EXECUTE FUNCTION check_discussion_link();

-- conversations belong to one proposal, the api checks participation on every request
CREATE TABLE conversations (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL REFERENCES proposals,
 kind text NOT NULL CHECK(kind IN ('direct','group')),
 title text CHECK(title IS NULL OR (length(trim(title)) > 0 AND length(title) <= 120)),
 CHECK((kind='group') = (title IS NOT NULL)),
 -- direct chats store their two users in order, so each pair has one chat per proposal
 direct_user_low_id uuid REFERENCES users,
 direct_user_high_id uuid REFERENCES users,
  CHECK((kind='direct' AND direct_user_low_id IS NOT NULL AND direct_user_high_id IS NOT NULL)
     OR (kind='group' AND direct_user_low_id IS NULL AND direct_user_high_id IS NULL)),
 CHECK(direct_user_low_id IS NULL OR direct_user_low_id < direct_user_high_id),
 UNIQUE(proposal_id,direct_user_low_id,direct_user_high_id),
 created_by_user_id uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 UNIQUE(proposal_id,id),
 -- only groups can be closed
 CHECK(kind='group' OR status='active'),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);

-- no membership foreign key: removed memberships must not block rejoining
-- the check_conversation_member trigger validates new and reactivated participants
CREATE TABLE conversation_members (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','left','removed')),
 added_by_user_id uuid NOT NULL REFERENCES users,
 joined_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 ended_by_user_id uuid REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,user_id),
 FOREIGN KEY(proposal_id,conversation_id) REFERENCES conversations(proposal_id,id),
 CHECK((status='active') = (ended_at IS NULL)),
 CHECK((status='active') = (ended_by_user_id IS NULL))
);

CREATE TABLE messages (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 author_user_id uuid NOT NULL REFERENCES users,
 body text NOT NULL CHECK(length(trim(body)) > 0 AND length(body) <= 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 FOREIGN KEY(proposal_id,conversation_id) REFERENCES conversations(proposal_id,id),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);
CREATE INDEX conversations_proposal ON conversations(proposal_id,status);
CREATE INDEX conversation_members_user ON conversation_members(proposal_id,user_id,status);
CREATE INDEX messages_conversation ON messages(conversation_id,created_at,id);

-- messaging access goes through the api
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE client_role text;
BEGIN
 FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON TABLE conversations, conversation_members, messages FROM %I', client_role);
 END LOOP;
END;
$$;

-- check new and reactivated participants only, keep history when someone leaves
CREATE FUNCTION check_conversation_member() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE conv record;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.proposal_id,NEW.conversation_id,NEW.user_id) IS DISTINCT FROM (OLD.proposal_id,OLD.conversation_id,OLD.user_id) THEN
   RAISE EXCEPTION 'Conversation participant identity cannot change' USING ERRCODE='23514';
  END IF;
 SELECT c.kind, c.status, c.direct_user_low_id, c.direct_user_high_id INTO conv
 FROM public.conversations c WHERE c.id=NEW.conversation_id AND c.proposal_id=NEW.proposal_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Conversation must belong to this proposal' USING ERRCODE='23514';
 END IF;
 -- direct chats keep exactly their two users, nobody can leave or join them later
 IF conv.kind='direct' AND (NEW.status<>'active' OR NEW.user_id<>conv.direct_user_low_id AND NEW.user_id<>conv.direct_user_high_id) THEN
  RAISE EXCEPTION 'Direct chats only include their two participants' USING ERRCODE='23514';
 END IF;
 IF NEW.status<>'active' THEN
  RETURN NEW;
 END IF;
 IF conv.status<>'active' THEN
  RAISE EXCEPTION 'Conversation is closed' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.proposal_memberships m
  JOIN public.users u ON u.id=m.user_id
  JOIN public.consortium_partners cp ON cp.id=m.partner_id AND cp.proposal_id=m.proposal_id
  WHERE m.proposal_id=NEW.proposal_id AND m.user_id=NEW.user_id
   AND m.status='active' AND m.access_role<>'viewer' AND u.status='active' AND cp.status='active'
 ) THEN
  RAISE EXCEPTION 'Conversation participant must be an active non-viewer member of this proposal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER conversation_member_check BEFORE INSERT OR UPDATE OF proposal_id,conversation_id,user_id,status ON conversation_members
FOR EACH ROW EXECUTE FUNCTION check_conversation_member();

-- direct participants cannot be deleted out of their fixed pair
CREATE FUNCTION keep_direct_participant() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.conversations WHERE id=OLD.conversation_id AND kind='direct') THEN
  RAISE EXCEPTION 'Direct chat participants cannot be deleted' USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END;
$$;
CREATE TRIGGER direct_participant_delete BEFORE DELETE ON conversation_members
FOR EACH ROW EXECUTE FUNCTION keep_direct_participant();

-- a new direct chat must end up with exactly its two participants
CREATE FUNCTION check_direct_conversation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id=NEW.id AND m.status='active') <> 2 THEN
  RAISE EXCEPTION 'Direct chats need exactly two active participants' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER direct_conversation_check AFTER INSERT ON conversations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind='direct') EXECUTE FUNCTION check_direct_conversation();

-- check new messages only, keep removed messages as history
CREATE FUNCTION check_message_author() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.status<>'active' THEN
  RETURN NEW;
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.conversations c
  JOIN public.conversation_members cm ON cm.conversation_id=c.id AND cm.proposal_id=c.proposal_id
  WHERE c.id=NEW.conversation_id AND c.proposal_id=NEW.proposal_id AND c.status='active'
   AND cm.user_id=NEW.author_user_id AND cm.status='active'
 ) THEN
  RAISE EXCEPTION 'Message author must be an active participant of an open conversation' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.proposal_memberships m
  JOIN public.users u ON u.id=m.user_id
  JOIN public.consortium_partners cp ON cp.id=m.partner_id AND cp.proposal_id=m.proposal_id
  WHERE m.proposal_id=NEW.proposal_id AND m.user_id=NEW.author_user_id
   AND m.status='active' AND m.access_role<>'viewer' AND u.status='active' AND cp.status='active'
 ) THEN
  RAISE EXCEPTION 'Message author must be an active non-viewer member of this proposal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER message_author_check BEFORE INSERT OR UPDATE OF proposal_id,conversation_id,author_user_id,status ON messages
FOR EACH ROW EXECUTE FUNCTION check_message_author();

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

-- requirements belong to one proposal, the code shown to people is REQ- plus the number
CREATE TABLE requirements (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL REFERENCES proposals,
 requirement_number integer NOT NULL CHECK(requirement_number > 0),
 title text NOT NULL CHECK(length(trim(title)) > 0 AND length(title) <= 200),
 description text CHECK(description IS NULL OR length(description) <= 10000),
 category text NOT NULL CHECK(category IN ('eligibility','administrative','submission')),
 -- no membership foreign key: a member who leaves must not block history
 owner_user_id uuid REFERENCES users,
 partner_id uuid,
 due_date date,
 priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
 -- only used while no task is linked, linked requirements follow their tasks
 manual_completed boolean NOT NULL DEFAULT false,
 created_by_user_id uuid NOT NULL REFERENCES users,
 updated_by_user_id uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 UNIQUE(proposal_id,id),
 UNIQUE(proposal_id,requirement_number),
 FOREIGN KEY(proposal_id,partner_id) REFERENCES consortium_partners(proposal_id,id),
 CHECK(owner_user_id IS NULL OR partner_id IS NOT NULL),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);

CREATE TABLE requirement_tasks (
 id uuid PRIMARY KEY,
 proposal_id uuid NOT NULL,
 requirement_id uuid NOT NULL,
 task_id uuid NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users,
 created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 removed_at timestamptz,
 removed_by_user_id uuid REFERENCES users,
 FOREIGN KEY(proposal_id,requirement_id) REFERENCES requirements(proposal_id,id),
 FOREIGN KEY(proposal_id,task_id) REFERENCES tasks(proposal_id,id),
 CHECK((status='active' AND removed_at IS NULL AND removed_by_user_id IS NULL)
    OR (status='removed' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX requirement_tasks_active ON requirement_tasks(requirement_id,task_id) WHERE status='active';
CREATE INDEX requirement_tasks_task ON requirement_tasks(proposal_id,task_id) WHERE status='active';
CREATE INDEX requirements_proposal ON requirements(proposal_id,status);

-- requirement access goes through the api
ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirement_tasks ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE client_role text;
BEGIN
 FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
  EXECUTE format('REVOKE ALL ON TABLE requirements, requirement_tasks FROM %I', client_role);
 END LOOP;
END;
$$;

-- check new and changed owners only, keep history when someone leaves
CREATE FUNCTION check_requirement_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.status<>'active' THEN
  RETURN NEW;
 END IF;
 IF NEW.owner_user_id IS NOT NULL THEN
  IF NOT EXISTS (
   SELECT 1 FROM public.proposal_memberships m
   JOIN public.users u ON u.id=m.user_id
   JOIN public.consortium_partners cp ON cp.id=m.partner_id AND cp.proposal_id=m.proposal_id
   WHERE m.proposal_id=NEW.proposal_id AND m.user_id=NEW.owner_user_id AND m.partner_id=NEW.partner_id
    AND m.status='active' AND m.access_role<>'viewer' AND u.status='active' AND cp.status='active'
  ) THEN
   RAISE EXCEPTION 'Requirement owner must be an active non-viewer member of the responsible partner' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.partner_id IS NOT NULL THEN
  IF NOT EXISTS (SELECT 1 FROM public.consortium_partners
    WHERE id=NEW.partner_id AND proposal_id=NEW.proposal_id AND status='active') THEN
   RAISE EXCEPTION 'Requirement partner must be active in this proposal' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER requirement_assignment_check BEFORE INSERT OR UPDATE OF proposal_id,owner_user_id,partner_id ON requirements
FOR EACH ROW EXECUTE FUNCTION check_requirement_assignment();

-- a new link needs an active requirement and an active task of the same proposal
CREATE FUNCTION check_requirement_task() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.status<>'active' THEN
  RETURN NEW;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.requirements WHERE id=NEW.requirement_id AND proposal_id=NEW.proposal_id AND status='active') THEN
  RAISE EXCEPTION 'Linked requirement must be active in this proposal' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE id=NEW.task_id AND proposal_id=NEW.proposal_id AND status='active') THEN
  RAISE EXCEPTION 'Linked task must be active in this proposal' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER requirement_task_check BEFORE INSERT OR UPDATE OF proposal_id,requirement_id,task_id,status ON requirement_tasks
FOR EACH ROW EXECUTE FUNCTION check_requirement_task();
