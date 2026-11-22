BEGIN;
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
COMMIT;
