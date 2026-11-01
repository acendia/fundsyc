export type Partner = {
  id: string;
  status: string;
  legal_name: string;
  city: string | null;
  country_code: string;
  full_name: string | null;
  email: string | null;
  responsibilities: string[];
};

export type Proposal = {
  id: string;
  title: string;
  acronym: string | null;
  status: string;
  coordinator_partner_id: string;
  partners: Partner[];
};

