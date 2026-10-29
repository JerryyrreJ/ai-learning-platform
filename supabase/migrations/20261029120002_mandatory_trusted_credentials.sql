-- CLI-generated; ordered after the base branch's future-dated migrations.
-- Password existence is NOT proof of ownership. No existing hashes are trusted.
begin;
create table private.password_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  fingerprint text not null,
  verified_at timestamptz not null default now()
);
alter table private.password_credentials enable row level security;
revoke all on private.password_credentials from public, anon, authenticated, service_role;
grant usage on schema private to service_role;

-- Only the trusted application server may snapshot/attest a password version.
-- Fingerprints never reach a public client, and no plaintext/hash is stored here.
create function private.password_credential_version(p_user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select encode(sha256(convert_to(encrypted_password, 'UTF8')), 'hex')
  from auth.users where id=p_user_id and coalesce(encrypted_password,'') <> '';
$$;
create function public.password_credential_version(p_user_id uuid) returns text
language sql security invoker set search_path = '' as $$
  select private.password_credential_version(p_user_id);
$$;
create function private.confirm_password_credential(p_user_id uuid, p_version text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare matched uuid;
begin
  -- Lock the Auth row across comparison/write: a subsequent password change
  -- immediately invalidates this record when readiness compares fingerprints.
  select id into matched from auth.users where id=p_user_id
    and email_confirmed_at is not null
    and private.password_credential_version(id)=p_version for update;
  if matched is null then return false; end if;
  insert into private.password_credentials(user_id,fingerprint) values(matched,p_version)
  on conflict(user_id) do update set fingerprint=excluded.fingerprint,verified_at=now();
  return true;
end;
$$;
create function public.confirm_password_credential(p_user_id uuid, p_version text) returns boolean
language sql security invoker set search_path = '' as $$
  select private.confirm_password_credential(p_user_id,p_version);
$$;
revoke all on function private.password_credential_version(uuid),public.password_credential_version(uuid),
  private.confirm_password_credential(uuid,text),public.confirm_password_credential(uuid,text) from public,anon,authenticated;
grant execute on function private.password_credential_version(uuid),public.password_credential_version(uuid),
  private.confirm_password_credential(uuid,text),public.confirm_password_credential(uuid,text) to service_role;

create function private.own_passkey_count() returns integer
language plpgsql stable security definer set search_path = '' as $$
declare n integer := 0;
begin
  -- Older Auth releases may not have native Passkeys. Password setup remains usable.
  if to_regclass('auth.webauthn_credentials') is not null then
    execute 'select count(*) from auth.webauthn_credentials where user_id=$1' into n using auth.uid();
  end if;
  return n;
end;
$$;
revoke all on function private.own_passkey_count() from public,anon;
grant execute on function private.own_passkey_count() to authenticated;

create or replace function private.own_account_security_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare trusted boolean; keys integer; confirmed boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if not private.account_mfa_satisfied() then raise exception 'MFA required'; end if;
  select email_confirmed_at is not null into confirmed from auth.users where id=auth.uid();
  select exists(select 1 from private.password_credentials p where p.user_id=auth.uid()
    and p.fingerprint=private.password_credential_version(auth.uid())) into trusted;
  trusted := trusted and coalesce(confirmed,false);
  keys := case when confirmed then private.own_passkey_count() else 0 end;
  return jsonb_build_object('has_password',trusted,'passkey_count',keys,
    'credential_ready',trusted or keys>0,
    'setup_reviewed',coalesce((select security_setup_reviewed_at is not null from public.profiles where id=auth.uid()),false));
end;
$$;

create function private.account_credential_satisfied() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.account_mfa_satisfied() then return false; end if;
  return (private.own_account_security_state()->>'credential_ready')::boolean;
end;
$$;
revoke all on function private.account_credential_satisfied() from public;
grant execute on function private.account_credential_satisfied() to anon,authenticated;

-- Own profile reads/edits bootstrap account security. All business records and
-- cross-user profile access require credentials in addition to the existing RLS.
create policy account_credential_guard on public.profiles as restrictive for all to authenticated
 using (id=auth.uid() or (select private.account_credential_satisfied()))
 with check (id=auth.uid() or (select private.account_credential_satisfied()));
do $$ declare tab text; begin
 foreach tab in array array['lesson_progress','activity_events','courses','course_enrolments',
 'course_invitations','learning_attempts','ai_usage','course_learner_preferences','simulation_sessions'] loop
 execute format('create policy account_credential_guard on public.%I as restrictive for all to authenticated using ((select private.account_credential_satisfied())) with check ((select private.account_credential_satisfied()))',tab);
 end loop;
end; $$;

create or replace function public.claim_course_invitations() returns integer language plpgsql security definer set search_path = '' as $$
declare n integer; verified_email text;
begin
  if not private.account_credential_satisfied() then raise exception 'Credential setup or MFA required'; end if;
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select lower(email) into verified_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if verified_email is null then raise exception 'Confirm your email first'; end if;
  insert into public.course_enrolments(course_id,student_id)
    select course_id, auth.uid() from public.course_invitations where email = verified_email on conflict do nothing;
  get diagnostics n = row_count;
  delete from public.course_invitations where email = verified_email;
  return n;
end; $$;

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
  if not private.account_credential_satisfied() then raise exception 'Credential setup or MFA required'; end if;
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
  if not private.account_credential_satisfied() then raise exception 'Credential setup or MFA required'; end if;
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
