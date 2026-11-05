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
  title: string;
  acronym: string | null;
  status: string;
  coordinator_partner_id: string;
  partners: Partner[];
  pending_invitations: { id: string; partner_id: string; kind: string; granted_role: string; legal_name: string; recipient_email: string; expires_at: string }[];
  responsibilities: Responsibility[];
  can_manage_responsibilities: boolean;
};

