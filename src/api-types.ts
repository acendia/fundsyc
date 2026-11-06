export type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type Contact = {
  id: string;
  full_name: string;
  email: string;
  job_title: string | null;
  phone: string | null;
};

export type Member = {
  id: string;
  display_name: string;
  email: string;
  access_role: string;
};

export type Partner = {
  id: string;
  status: string;
  legal_name: string;
  city: string | null;
  country_code: string;
  full_name: string | null;
  email: string | null;
  responsibilities: string[];
  contacts: Contact[];
  primary_contact_id: string | null;
  can_manage_contacts: boolean;
  can_withdraw: boolean;
  members: Member[];
};

export type Responsibility = {
  id: string;
  title: string;
  description: string | null;
  partner_ids: string[];
};

export type Proposal = {
  id: string;
  created_at: string;
  title: string;
  acronym: string | null;
  status: string;
  coordinator_partner_id: string;
  partners: Partner[];
  pending_invitations: { id: string; partner_id: string; kind: string; granted_role: string; legal_name: string; recipient_email: string; expires_at: string }[];
  responsibilities: Responsibility[];
  can_manage_responsibilities: boolean;
};


export type DocumentRecord = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  owner_user_id: string;
  owner_name: string;
  added_by_name: string;
  updated_at: string;
  can_edit: boolean;
  versions: DocumentVersionRecord[];
};

export type DocumentList = {
  reviewers: { user_id: string; display_name: string }[];
  proposal: { title: string; status: string };
  current_user_id: string;
  can_add: boolean;
  owners: { user_id: string; display_name: string }[];
  documents: DocumentRecord[];
};

export type DocumentReviewRecord = {
  id: string;
  reviewer_user_id: string;
  reviewer_name: string;
  requested_by_name: string;
  created_at: string;
  resolved_at: string | null;
  status: string;
  due_date: string | null;
  instructions: string | null;
  response: string | null;
  can_respond: boolean;
  can_cancel: boolean;
};
export type DocumentVersionRecord = {
  id: string;
  version_number: number;
  source_kind: string;
  file_name: string | null;
  size_bytes: number | null;
  external_url: string | null;
  created_at: string;
  added_by_name: string;
  version_note: string | null;
  review_status: string;
  reviews: DocumentReviewRecord[];
};
