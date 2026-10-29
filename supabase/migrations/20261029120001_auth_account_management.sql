-- Created with `supabase migration new auth_account_management`, then ordered
-- after the base branch's 20261029120000 migration (its timestamp is ahead of
-- the development host). Apply to a staging project before production.
begin;

alter table public.profiles add column security_setup_reviewed_at timestamptz;
grant update (security_setup_reviewed_at) on public.profiles to authenticated;

-- Live factor lookup prevents a stale aal1 token bypassing MFA after enrollment.
-- No user id argument; these helpers can inspect only the authenticated caller.
create function private.account_mfa_satisfied() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is null or (
    coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2' or not exists (
      select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified'
    )
  );
$$;
revoke all on function private.account_mfa_satisfied() from public;
grant execute on function private.account_mfa_satisfied() to authenticated, anon;

-- Read only a boolean, never the password hash. The public wrapper runs with
-- invoker privileges; its tightly scoped helper lives outside the Data API.
create function private.own_account_security_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not private.account_mfa_satisfied() then raise exception 'MFA required'; end if;
  return (
    select jsonb_build_object(
      'has_password', coalesce(u.encrypted_password, '') <> '',
      'setup_reviewed', p.security_setup_reviewed_at is not null
    ) from auth.users u join public.profiles p on p.id = u.id where u.id = auth.uid()
  );
end;
$$;
revoke all on function private.own_account_security_state() from public, anon;
grant execute on function private.own_account_security_state() to authenticated;

create function public.account_security_state() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.own_account_security_state();
$$;
revoke all on function public.account_security_state() from public, anon;
grant execute on function public.account_security_state() to authenticated;

-- Add restrictive policies, retaining every existing ownership/role policy.
-- Explicit table list makes the policy scope reviewable.
do $$
declare tab text;
begin
  foreach tab in array array['profiles', 'lesson_progress', 'activity_events',
    'courses', 'course_enrolments', 'course_invitations', 'learning_attempts',
    'ai_usage', 'course_learner_preferences', 'simulation_sessions']
  loop
    execute format('create policy account_mfa_guard on public.%I as restrictive for all to authenticated using ((select private.account_mfa_satisfied())) with check ((select private.account_mfa_satisfied()))', tab);
  end loop;
end;
$$;

-- Definer RPCs bypass RLS, so enforce MFA inside their bodies too.
create or replace function public.claim_course_invitations() returns integer language plpgsql security definer set search_path = '' as $$
declare n integer; verified_email text;
begin
  if not private.account_mfa_satisfied() then raise exception 'MFA required'; end if;
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select lower(email) into verified_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if verified_email is null then raise exception 'Confirm your email first'; end if;
  insert into public.course_enrolments(course_id,student_id)
    select course_id, auth.uid() from public.course_invitations where email = verified_email on conflict do nothing;
  get diagnostics n = row_count;
  delete from public.course_invitations where email = verified_email;
  return n;
end; $$;

-- Definer RPCs bypass RLS, so enforce MFA inside their bodies too.
create or replace function public.consume_ai_quota(p_bucket text, max_hits integer, window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  start_at timestamptz;
  current_hits integer;
begin
  if not private.account_mfa_satisfied() then raise exception 'MFA required'; end if;
  if uid is null then
    raise exception 'Sign in required';
  end if;
  if p_bucket not in ('generation', 'feedback', 'tutor', 'roleplay', 'prompt-lab') then
    raise exception 'Unknown quota bucket';
  end if;
  if max_hits < 1 or max_hits > 100 or window_seconds <> 3600 then
    raise exception 'Invalid quota window';
  end if;
  start_at := to_timestamp(floor(extract(epoch from clock_timestamp()) / window_seconds) * window_seconds);
  insert into public.ai_usage as usage (user_id, bucket, window_start, hits)
  values (uid, p_bucket, start_at, 1)
  on conflict on constraint ai_usage_pkey
  do update set hits = usage.hits + 1
  returning usage.hits into current_hits;
  return current_hits <= max_hits;
end;
$$;

-- Definer RPCs bypass RLS, so enforce MFA inside their bodies too.
create or replace function public.activate_instructor()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  verified_at timestamptz;
  profile_role text;
begin
  if not private.account_mfa_satisfied() then raise exception 'MFA required'; end if;
  if uid is null then
    raise exception 'Sign in required';
  end if;

  select email_confirmed_at into verified_at
  from auth.users
  where id = uid;

  if verified_at is null then
    raise exception 'Confirm your email first';
  end if;

  insert into public.profiles (id)
  values (uid)
  on conflict (id) do nothing;

  -- Avoid the name current_role: it collides with the SQL built-in.
  select role into profile_role
  from public.profiles
  where id = uid
  for update;

  if profile_role is null then
    raise exception 'Your profile is unavailable';
  end if;

  -- Never demote or invent admin through onboarding.
  if profile_role = 'admin' then
    return 'admin';
  end if;

  if profile_role = 'instructor' then
    update public.profiles
    set intended_workspace = coalesce(intended_workspace, 'teach'),
        onboarding_completed_at = coalesce(onboarding_completed_at, now()),
        updated_at = now()
    where id = uid;
    return 'instructor';
  end if;

  if profile_role <> 'student' then
    raise exception 'Role cannot be changed';
  end if;

  -- Runs as the function owner, so private.guard_profile_role allows the change.
  update public.profiles
  set role = 'instructor',
      intended_workspace = 'teach',
      onboarding_completed_at = coalesce(onboarding_completed_at, now()),
      updated_at = now()
  where id = uid;

  return 'instructor';
end;
$$;

commit;
