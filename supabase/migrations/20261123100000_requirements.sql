BEGIN;
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
COMMIT;
