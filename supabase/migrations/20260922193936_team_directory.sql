-- The gateway may list team names and URL slugs, never roster or contact data.
create function public.portal_team_directory()
returns table (slug text, name text, club_name text)
language sql stable security invoker
set search_path = ''
as $$
  select t.slug, coalesce(t.state #>> '{team,name}', t.slug),
    coalesce(t.state #>> '{team,clubName}', '')
  from portal_private.teams t
  order by t.slug;
$$;
revoke all on function public.portal_team_directory() from public, anon, authenticated;
grant execute on function public.portal_team_directory() to service_role;
