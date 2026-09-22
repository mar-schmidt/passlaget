-- Supabase Studio's Display name prefers user metadata.name. Metadata is used
-- only for presentation; current team membership still controls who is listed.
grant select (raw_user_meta_data) on auth.users to service_role;
create or replace function public.portal_admin_contacts(p_team_id text)
returns table (name text, email text)
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(u.raw_user_meta_data->>'name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'displayName'), ''),
    nullif(btrim(u.raw_user_meta_data->>'display_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'fullName'), ''),
    nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
    u.email
  ) as name, u.email
  from portal_private.admin_memberships m
  join auth.users u on u.id = m.user_id
  where m.team_id = p_team_id
    and nullif(btrim(u.email), '') is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
  order by name, u.email;
$$;
revoke all on function public.portal_admin_contacts(text) from public, anon, authenticated;
grant execute on function public.portal_admin_contacts(text) to service_role;
