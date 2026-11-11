BEGIN;
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
COMMIT;
