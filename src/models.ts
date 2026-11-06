
// ids for the different records
export type UUID = string;
export type UserStatus = "active" | "disabled";
export type OrganizationType =
  | "university"
  | "research_institute"
  | "company"
  | "public_body"
  | "nonprofit"
  | "other";
export type ProposalStatus =
  | "draft"
  | "in_preparation"
  | "submitted"
  | "archived";
export type PartnerStatus = "invited" | "active" | "withdrawn" | "removed";
export type AccessRole =
  | "coordinator_manager"
  | "partner_admin"
  | "contributor"
  | "viewer";
export type MembershipStatus = "active" | "revoked";
export type InvitationKind = "organization" | "member";
export type InvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "revoked"
  | "expired";
export type InvitationRole = Exclude<AccessRole, "coordinator_manager">;

export const documentCategories = [
  { value: "proposal_drafts", label: "Proposal drafts" },
  { value: "budget_finance", label: "Budget & finance" },
  { value: "legal_documents", label: "Legal documents" },
  { value: "supporting_evidence", label: "Supporting evidence" },
] as const;

export type DocumentCategory = (typeof documentCategories)[number]["value"];
export type DocumentStatus = "active" | "removed";

export type DocumentSourceKind = "uploaded_file" | "external_link";

export type DocumentSource =
  | {
      kind: "uploaded_file";
      storageKey: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
    }
  | {
      kind: "external_link";
      url: string;
    };




// the person using the platform
export class User {
  constructor(
    public id: UUID,
    public authSubject: string,
    public email: string,
    public emailKey: string,
    public emailVerifiedAt: Date | null,
    public displayName: string,
    public status: UserStatus,
    public createdAt: Date,
    public updatedAt: Date,
  ) {}
}

// the organization itself, can join more than one proposal
export class Organization {
  constructor(
    public id: UUID,
    public legalName: string,
    public shortName: string | null,
    public organizationType: OrganizationType,
    public countryCode: string,
    public city: string | null,
    public websiteUrl: string | null,
    public externalIdentifierScheme: string | null,
    public externalIdentifierValue: string | null,
    public createdAt: Date,
    public updatedAt: Date,
  ) {}
}

// proposal and its coordinator
export class Proposal {
  constructor(
    public id: UUID,
    public title: string,
    public acronym: string | null,
    public status: ProposalStatus,
    public coordinatorPartnerId: UUID,
    public createdByUserId: UUID,
    public createdAt: Date,
    public updatedAt: Date,
  ) {}
}

// an organization taking part in a proposal
export class ConsortiumPartner {
  constructor(
    public id: UUID,
    public proposalId: UUID,
    public organizationId: UUID,
    public status: PartnerStatus,
    public primaryContactId: UUID | null,
    public joinedAt: Date | null,
    public endedAt: Date | null,
    public createdAt: Date,
    public updatedAt: Date,
  ) {}
}

// contact details, the person might not have an account
export class PartnerContact {
  constructor(
    public id: UUID,
    public proposalId: UUID,
    public partnerId: UUID,
    public fullName: string,
    public email: string,
    public emailKey: string,
    public jobTitle: string | null,
    public phone: string | null,
    public userId: UUID | null,
    public createdAt: Date,
    public updatedAt: Date,
    public status: "active" | "removed" = "active",
    public removedAt: Date | null = null,
  ) {}
}

// who has access to the proposal and what they can do
export class ProposalMembership {
  constructor(
    public id: UUID,
    public proposalId: UUID,
    public partnerId: UUID,
    public userId: UUID,
    public accessRole: AccessRole,
    public status: MembershipStatus,
    public joinedAt: Date,
    public revokedAt: Date | null,
    public grantedByUserId: UUID,
    public createdAt: Date,
    public updatedAt: Date,
  ) {}
}

// areas of work for the proposal
export class Responsibility {
  constructor(
    public id: UUID,
    public proposalId: UUID,
    public title: string,
    public description: string | null,
    public sortOrder: number,
    public createdAt: Date,
    public updatedAt: Date,
    public status: "active" | "removed" = "active",
    public removedAt: Date | null = null,
  ) {}
}

// links a partner to a responsibility
export class PartnerResponsibility {
  constructor(
    public proposalId: UUID,
    public partnerId: UUID,
    public responsibilityId: UUID,
    public sortOrder: number,
    public createdAt: Date,
    public status: "active" | "removed" = "active",
    public removedAt: Date | null = null,
  ) {}
}

// invitation first, access only after acceptance
export class ConsortiumInvitation {
  constructor(
    public id: UUID,
    public proposalId: UUID,
    public partnerId: UUID,
    public kind: InvitationKind,
    public recipientEmail: string,
    public recipientEmailKey: string,
    public recipientName: string | null,
    public grantedRole: InvitationRole,
    public tokenHash: string,
    public status: InvitationStatus,
    public invitedByUserId: UUID,
    public sentAt: Date | null,
    public expiresAt: Date,
    public resolvedAt: Date | null,
    public acceptedByUserId: UUID | null,
    public createdAt: Date,
    public updatedAt: Date,
  ) {}
}
// keep track of important changes
export class AuditEvent {
  constructor(
    public id: UUID,
    public proposalId: UUID,
    public actorUserId: UUID | null,
    public action: string,
    public entityType: string,
    public entityId: UUID,
    public metadata: Record<string, unknown>,
    public createdAt: Date,
  ) {}
}

// one document in a proposal, owner and uploader can differ
export class ProposalDocument {
  constructor(
    public id: UUID,
    public proposalId: UUID,
    public title: string,
    public description: string | null,
    public category: DocumentCategory,
    public ownerUserId: UUID,
    public addedByUserId: UUID,
    public createdAt: Date,
    public updatedAt: Date,
    public updatedByUserId: UUID,
    public status: DocumentStatus = "active",
    public removedAt: Date | null = null,
    public removedByUserId: UUID | null = null,
  ) {}
}

// each version points to its own file or link
export class DocumentVersion {
  constructor(
    public id: UUID,
    public proposalId: UUID,
    public documentId: UUID,
    public versionNumber: number,
    public source: DocumentSource,
    public addedByUserId: UUID,
    public versionNote: string | null,
    public createdAt: Date,
    public reviewStatus: "not_submitted" | "in_review" | "approved" | "changes_requested" = "not_submitted",
  ) {}
}

// a review belongs to one fixed version
export class DocumentReview {
  constructor(
    public id: UUID,
    public proposalId: UUID,
    public versionId: UUID,
    public requestedByUserId: UUID,
    public reviewerUserId: UUID,
    public dueDate: string | null,
    public instructions: string | null,
    public response: string | null,
    public status: "pending" | "approved" | "changes_requested" | "cancelled",
    public resolvedAt: Date | null,
    public createdAt: Date,
    public updatedAt: Date,
  ) {}
}
