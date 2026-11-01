export type Contact = {
  id: string;
  full_name: string;
  email: string;
  job_title: string | null;
  phone: string | null;
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
  responsibilities: Responsibility[];
  can_manage_responsibilities: boolean;
};

