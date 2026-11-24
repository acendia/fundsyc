-- task history is read newest first, a page at a time, so it needs its own index
-- the proposal index alone would walk through every audit event of the proposal
CREATE INDEX IF NOT EXISTS audit_task_history ON audit_events(proposal_id,entity_id,created_at DESC,id DESC) WHERE entity_type='task';
