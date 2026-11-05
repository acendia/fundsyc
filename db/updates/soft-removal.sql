BEGIN;
ALTER TABLE partner_contacts ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')), ADD COLUMN removed_at timestamptz, ADD CHECK((status='removed') = (removed_at IS NOT NULL));
ALTER TABLE partner_contacts DROP CONSTRAINT partner_contacts_partner_id_email_key_key;
CREATE UNIQUE INDEX active_contact_email ON partner_contacts(partner_id,email_key) WHERE status='active';
ALTER TABLE responsibilities ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')), ADD COLUMN removed_at timestamptz, ADD CHECK((status='removed') = (removed_at IS NOT NULL));
ALTER TABLE partner_responsibilities ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')), ADD COLUMN removed_at timestamptz, ADD CHECK((status='removed') = (removed_at IS NOT NULL));
COMMIT;
