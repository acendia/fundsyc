BEGIN;
-- no membership foreign key here: removed assignment history must not block reassignment.
-- the check_task_assignee trigger validates new and changed active assignments instead.
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

-- copy existing single assignees, before the trigger so inactive members still migrate
-- removed tasks keep their removal details, so their assignee rows are history too
INSERT INTO task_assignees(id,proposal_id,task_id,partner_id,user_id,assigned_by_user_id,assigned_at,created_at,updated_at,status,removed_at,removed_by_user_id)
SELECT gen_random_uuid(),t.proposal_id,t.id,t.partner_id,t.assignee_user_id,t.assigned_by_user_id,t.assigned_at,t.assigned_at,coalesce(t.removed_at,t.assigned_at),
 CASE WHEN t.status='removed' THEN 'removed' ELSE 'active' END,
 CASE WHEN t.status='removed' THEN t.removed_at END,
 CASE WHEN t.status='removed' THEN t.removed_by_user_id END
FROM tasks t
WHERE t.assignee_user_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.user_id=t.assignee_user_id AND a.status='active');

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
COMMIT;
