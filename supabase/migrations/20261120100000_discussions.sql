BEGIN;
-- no membership foreign key here: removed memberships must not block rejoining.
-- the check_discussion_author trigger validates new and changed authors instead.
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
COMMIT;
