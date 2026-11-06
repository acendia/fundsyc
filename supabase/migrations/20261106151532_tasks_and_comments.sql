BEGIN;
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

COMMIT;
