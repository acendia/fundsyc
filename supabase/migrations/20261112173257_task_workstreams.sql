BEGIN;
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
COMMIT;
