-- Contact details are resolved from current team memberships, never from browser input
-- or a copied list in portal state. Only the Edge function can call this RPC.
grant select (deleted_at, banned_until) on auth.users to service_role;
create function public.portal_admin_contacts(p_team_id text)
returns table (name text, email text)
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(parent.name, u.email) as name, u.email
  from portal_private.admin_memberships m
  join auth.users u on u.id = m.user_id
  join portal_private.teams t on t.id = m.team_id
  left join lateral (
    select nullif(btrim(a->>'name'), '') as name
    from jsonb_array_elements(t.state->'adults') a
    where lower(btrim(a->>'email')) = lower(u.email)
      and a->>'active' = 'true'
      and nullif(btrim(a->>'name'), '') is not null
    order by a->>'id'
    limit 1
  ) parent on true
  where m.team_id = p_team_id
    and nullif(btrim(u.email), '') is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
  order by lower(coalesce(parent.name, u.email)), u.email;
$$;
revoke all on function public.portal_admin_contacts(text) from public, anon, authenticated;
grant execute on function public.portal_admin_contacts(text) to service_role;
