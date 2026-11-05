import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";

// these mappings describe existing columns; db/schema.sql owns the database constraints
export const users = pgTable("users", { id: uuid("id"), displayName: text("display_name"), email: text("email"), emailKey: text("email_key"), status: text("status") });
export const organizations = pgTable("organizations", { id: uuid("id"), legalName: text("legal_name"), organizationType: text("organization_type"), countryCode: text("country_code"), city: text("city") });
export const proposals = pgTable("proposals", { id: uuid("id"), title: text("title"), acronym: text("acronym"), status: text("status"), coordinatorPartnerId: uuid("coordinator_partner_id"), createdByUserId: uuid("created_by_user_id"), createdAt: timestamp("created_at", { withTimezone: true }) });
export const partners = pgTable("consortium_partners", { id: uuid("id"), proposalId: uuid("proposal_id"), organizationId: uuid("organization_id"), status: text("status"), primaryContactId: uuid("primary_contact_id"), joinedAt: timestamp("joined_at", { withTimezone: true }) });
export const contacts = pgTable("partner_contacts", { id: uuid("id"), proposalId: uuid("proposal_id"), partnerId: uuid("partner_id"), fullName: text("full_name"), email: text("email"), emailKey: text("email_key"), userId: uuid("user_id"), status: text("status"), removedAt: timestamp("removed_at", { withTimezone: true }), updatedAt: timestamp("updated_at", { withTimezone: true }) });
export const memberships = pgTable("proposal_memberships", { id: uuid("id"), proposalId: uuid("proposal_id"), partnerId: uuid("partner_id"), userId: uuid("user_id"), accessRole: text("access_role"), status: text("status"), grantedByUserId: uuid("granted_by_user_id") });
export const auditEvents = pgTable("audit_events", { id: uuid("id"), proposalId: uuid("proposal_id"), actorUserId: uuid("actor_user_id"), action: text("action"), entityType: text("entity_type"), entityId: uuid("entity_id") });
