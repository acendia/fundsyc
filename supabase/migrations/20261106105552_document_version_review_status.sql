BEGIN;
ALTER TABLE document_versions ADD COLUMN review_status text NOT NULL DEFAULT 'not_submitted' CHECK(review_status='not_submitted');
COMMIT;
