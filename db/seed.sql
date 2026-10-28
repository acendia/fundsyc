-- example data for a local database
begin;
insert into users (id, auth_subject, email, email_key, display_name, email_verified_at) values
  ('00000000-0000-4000-8000-000000000001', 'demo:coordinator', 'researcher@example.org', 'researcher@example.org', 'Example Researcher', now())
on conflict (id) do nothing;
insert into organizations (id, legal_name, organization_type, country_code, city) values
  ('10000000-0000-4000-8000-000000000001', 'Example University', 'university', 'GR', 'Athens')
on conflict (id) do nothing;
insert into proposals (id, title, acronym, coordinator_partner_id, created_by_user_id) values
  ('20000000-0000-4000-8000-000000000001', 'Collaborative Research Proposal', 'CRP', '30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;
insert into consortium_partners (id, proposal_id, organization_id, status, primary_contact_id, joined_at) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'active', '40000000-0000-4000-8000-000000000001', now())
on conflict (id) do nothing;
insert into partner_contacts (id, proposal_id, partner_id, full_name, email, email_key, user_id) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Example Researcher', 'researcher@example.org', 'researcher@example.org', '00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;
insert into proposal_memberships (id, proposal_id, partner_id, user_id, access_role, granted_by_user_id) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'coordinator_manager', '00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;
insert into responsibilities (id, proposal_id, title) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Proposal coordination')
on conflict (id) do nothing;
insert into partner_responsibilities (proposal_id, partner_id, responsibility_id) values
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001')
on conflict do nothing;
commit;
