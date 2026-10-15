-- Test-only additive migration. Never included in production initialization.
ALTER TABLE public.users ADD COLUMN round4_optional_note text;
CREATE INDEX round4_users_name_idx ON public.users USING btree (user_name);
CREATE TABLE public.round4_schema_probe (id bigint PRIMARY KEY, note text);
