-- example history for the task "Collect campus energy data" in the SMARTCAMPUS proposal
-- the story ends exactly at the task's current state, so progress, priority, due date and assignee do not change
-- everything is looked up by name, the fixed ids make a second run do nothing
-- runs as one block, if any check fails nothing is added
DO $$
DECLARE
  proposal uuid;
  task record;
  harokopio uuid;
  maria uuid;
  sofia uuid;
  eleni uuid;
  day0 timestamptz;
  eid uuid[] := ARRAY(SELECT md5('fundsyc example task history event ' || n)::uuid FROM generate_series(1, 12) n);
  cid uuid[] := ARRAY(SELECT md5('fundsyc example task history comment ' || n)::uuid FROM generate_series(1, 5) n);
  maria_assignment uuid := md5('fundsyc example task history assignee maria')::uuid;
BEGIN
  IF (SELECT count(*) FROM proposals WHERE title = 'SMARTCAMPUS Sustainable University Campuses') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one SMARTCAMPUS Sustainable University Campuses proposal';
  END IF;
  SELECT id INTO proposal FROM proposals WHERE title = 'SMARTCAMPUS Sustainable University Campuses';

  IF EXISTS (SELECT 1 FROM audit_events WHERE id = eid[1]) THEN
    RAISE NOTICE 'Example task history is already there, nothing added.';
    RETURN;
  END IF;

  SELECT * INTO task FROM tasks WHERE proposal_id = proposal AND title = 'Collect campus energy data' AND status = 'active';
  IF task.id IS NULL THEN RAISE EXCEPTION 'Task "Collect campus energy data" not found'; END IF;

  -- the three people of the story, all active members of this proposal
  SELECT m.user_id, m.partner_id INTO maria, harokopio FROM proposal_memberships m JOIN users u ON u.id = m.user_id
    WHERE m.proposal_id = proposal AND u.display_name = 'Maria Antoniou' AND m.status = 'active' AND u.status = 'active';
  SELECT m.user_id INTO sofia FROM proposal_memberships m JOIN users u ON u.id = m.user_id
    WHERE m.proposal_id = proposal AND u.display_name = 'Sofia Dimitriou' AND m.partner_id = harokopio AND m.status = 'active' AND u.status = 'active';
  SELECT m.user_id INTO eleni FROM proposal_memberships m JOIN users u ON u.id = m.user_id
    WHERE m.proposal_id = proposal AND u.display_name = 'Eleni Papadopoulou' AND m.status = 'active' AND u.status = 'active';
  IF maria IS NULL OR sofia IS NULL OR eleni IS NULL THEN
    RAISE EXCEPTION 'Maria Antoniou, Sofia Dimitriou (Harokopio) and Eleni Papadopoulou must be active members';
  END IF;

  -- the story only fits the task as it is now
  IF task.partner_id <> harokopio OR task.progress <> 'in_progress' OR task.priority <> 'urgent'
    OR (SELECT array_agg(user_id) FROM task_assignees WHERE task_id = task.id AND status = 'active') IS DISTINCT FROM ARRAY[sofia] THEN
    RAISE EXCEPTION 'The task changed since the example was written (expected Harokopio, in progress, urgent, assigned to Sofia only)';
  END IF;

  -- events start the day after the task was created and must all be in the past
  day0 := date_trunc('day', task.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF day0 + interval '12 days' > now() THEN RAISE EXCEPTION 'The task is too recent for this example timeline'; END IF;
  IF EXISTS (SELECT 1 FROM audit_events WHERE entity_type = 'task' AND entity_id = task.id AND created_at >= day0 + interval '1 day') THEN
    RAISE EXCEPTION 'The task already has later history, so the example would not fit';
  END IF;

  -- day 1: sofia starts collecting the meter data
  INSERT INTO task_comments(id, proposal_id, task_id, author_user_id, body, created_at, updated_at) VALUES
    (cid[1], proposal, task.id, sofia, 'I have asked the estates office for the 2023–2025 monthly meter exports for the four main campus buildings.', day0 + interval '1 day 08:40', day0 + interval '1 day 08:40');
  INSERT INTO audit_events(id, proposal_id, actor_user_id, action, entity_type, entity_id, metadata, created_at) VALUES
    (eid[1], proposal, sofia, 'task.comment_added', 'task', task.id, jsonb_build_object('comment_id', cid[1]), day0 + interval '1 day 08:40');

  -- day 3: maria joins the task to take over the floor areas
  INSERT INTO task_assignees(id, proposal_id, task_id, partner_id, user_id, assigned_by_user_id, assigned_at, created_at, updated_at) VALUES
    (maria_assignment, proposal, task.id, harokopio, maria, maria, day0 + interval '3 days 09:15', day0 + interval '3 days 09:15', day0 + interval '3 days 09:15');
  INSERT INTO audit_events(id, proposal_id, actor_user_id, action, entity_type, entity_id, metadata, created_at) VALUES
    (eid[2], proposal, maria, 'task.reassigned', 'task', task.id, jsonb_build_object(
      'before', jsonb_build_object('partner', 'Harokopio University', 'assignee', 'Sofia Dimitriou'),
      'after', jsonb_build_object('partner', 'Harokopio University', 'assignee', 'Maria Antoniou, Sofia Dimitriou')), day0 + interval '3 days 09:15');
  INSERT INTO task_comments(id, proposal_id, task_id, author_user_id, body, created_at, updated_at) VALUES
    (cid[2], proposal, task.id, maria, 'I will take the floor areas from the facilities register so Sofia can focus on the meter data.', day0 + interval '3 days 09:18', day0 + interval '3 days 09:18');
  INSERT INTO audit_events(id, proposal_id, actor_user_id, action, entity_type, entity_id, metadata, created_at) VALUES
    (eid[3], proposal, maria, 'task.comment_added', 'task', task.id, jsonb_build_object('comment_id', cid[2]), day0 + interval '3 days 09:18');

  -- day 4: the estates office confirmed the delivery, so the priority drops for now
  INSERT INTO audit_events(id, proposal_id, actor_user_id, action, entity_type, entity_id, metadata, created_at) VALUES
    (eid[4], proposal, maria, 'task.updated', 'task', task.id, jsonb_build_object('changes', jsonb_build_object(
      'priority', jsonb_build_object('before', 'urgent', 'after', 'high'))), day0 + interval '4 days 13:05');

  -- day 5: sofia reports the consumption totals and then adds the invoice check to her comment
  INSERT INTO task_comments(id, proposal_id, task_id, author_user_id, body, created_at, updated_at) VALUES
    (cid[3], proposal, task.id, sofia, 'Monthly electricity totals for 2023–2025 are complete for all four buildings and cross-checked against the supplier invoices.', day0 + interval '5 days 11:30', day0 + interval '5 days 11:42');
  INSERT INTO audit_events(id, proposal_id, actor_user_id, action, entity_type, entity_id, metadata, created_at) VALUES
    (eid[5], proposal, sofia, 'task.comment_added', 'task', task.id, jsonb_build_object('comment_id', cid[3]), day0 + interval '5 days 11:30'),
    (eid[6], proposal, sofia, 'task.comment_edited', 'task', task.id, jsonb_build_object('comment_id', cid[3]), day0 + interval '5 days 11:42');

  -- day 8: sofia sends the data for review
  INSERT INTO audit_events(id, proposal_id, actor_user_id, action, entity_type, entity_id, metadata, created_at) VALUES
    (eid[7], proposal, sofia, 'task.progress_changed', 'task', task.id, jsonb_build_object('before', 'in_progress', 'after', 'in_review'), day0 + interval '8 days 14:20');

  -- day 9: the coordinator finds two estimated floor areas, the task goes back to work and becomes urgent again
  INSERT INTO task_comments(id, proposal_id, task_id, author_user_id, body, created_at, updated_at) VALUES
    (cid[4], proposal, task.id, eleni, 'Thanks, the consumption data looks complete. The library and laboratory floor areas are still estimates, and the annex needs confirmed values.', day0 + interval '9 days 10:05', day0 + interval '9 days 10:05');
  INSERT INTO audit_events(id, proposal_id, actor_user_id, action, entity_type, entity_id, metadata, created_at) VALUES
    (eid[8], proposal, eleni, 'task.comment_added', 'task', task.id, jsonb_build_object('comment_id', cid[4]), day0 + interval '9 days 10:05'),
    (eid[9], proposal, maria, 'task.progress_changed', 'task', task.id, jsonb_build_object('before', 'in_review', 'after', 'in_progress'), day0 + interval '9 days 10:30'),
    (eid[10], proposal, eleni, 'task.updated', 'task', task.id, jsonb_build_object('changes', jsonb_build_object(
      'priority', jsonb_build_object('before', 'high', 'after', 'urgent'))), day0 + interval '9 days 10:34');

  -- day 11: maria adds the register values and hands the last confirmations back to sofia
  UPDATE task_assignees SET status = 'removed', removed_at = day0 + interval '11 days 12:10', removed_by_user_id = maria, updated_at = day0 + interval '11 days 12:10'
    WHERE id = maria_assignment;
  INSERT INTO audit_events(id, proposal_id, actor_user_id, action, entity_type, entity_id, metadata, created_at) VALUES
    (eid[11], proposal, maria, 'task.reassigned', 'task', task.id, jsonb_build_object(
      'before', jsonb_build_object('partner', 'Harokopio University', 'assignee', 'Maria Antoniou, Sofia Dimitriou'),
      'after', jsonb_build_object('partner', 'Harokopio University', 'assignee', 'Sofia Dimitriou')), day0 + interval '11 days 12:10');
  INSERT INTO task_comments(id, proposal_id, task_id, author_user_id, body, created_at, updated_at) VALUES
    (cid[5], proposal, task.id, maria, 'I have added the register values for the other buildings. Sofia will confirm the library and laboratory floor areas with the estates office.', day0 + interval '11 days 12:12', day0 + interval '11 days 12:12');
  INSERT INTO audit_events(id, proposal_id, actor_user_id, action, entity_type, entity_id, metadata, created_at) VALUES
    (eid[12], proposal, maria, 'task.comment_added', 'task', task.id, jsonb_build_object('comment_id', cid[5]), day0 + interval '11 days 12:12');

  -- "last modified" follows the last change to the task itself
  UPDATE tasks SET updated_at = day0 + interval '11 days 12:10', updated_by_user_id = maria
    WHERE id = task.id AND proposal_id = proposal AND updated_at < day0 + interval '11 days 12:10';

  RAISE NOTICE 'Added 12 history events and 5 comments to "Collect campus energy data".';
END;
$$;
