BEGIN;
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

REVOKE ALL ON TABLE documents, document_versions, document_reviews FROM anon, authenticated;

COMMIT;
