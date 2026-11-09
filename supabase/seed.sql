-- LOCAL DEVELOPMENT ONLY. Never run against a hosted project.
-- Platform owner: owner@local.test / owner-password-123

do $$
declare
  owner_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token
  ) values (
    '00000000-0000-0000-0000-000000000000', owner_id, 'authenticated', 'authenticated',
    'owner@local.test', extensions.crypt('owner-password-123', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', '{"password_set": true}', now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), owner_id, owner_id::text, 'email',
    jsonb_build_object('sub', owner_id::text, 'email', 'owner@local.test', 'email_verified', true),
    now(), now(), now()
  );

  -- profile row is created by the handle_new_user trigger
  update public.profiles set is_platform_owner = true where user_id = owner_id;
end;
$$;
