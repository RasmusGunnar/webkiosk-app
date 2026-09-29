select jsonb_build_object(
'columns',(select jsonb_agg(to_jsonb(c) order by table_name,ordinal_position) from (select table_name,column_name,data_type,udt_name,is_nullable,column_default,ordinal_position from information_schema.columns where table_schema='public') c),
'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'),
'indexes',(select jsonb_agg(to_jsonb(i)) from pg_indexes i where schemaname='public'),
'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname in ('public','storage')),
'rls',(select jsonb_agg(jsonb_build_object('table',c.relname,'enabled',c.relrowsecurity,'forced',c.relforcerowsecurity)) from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='public' and c.relkind='r'),
'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl)) from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.prokind='f' and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')),
'private_functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl)) from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='private' and p.prokind='f' and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')),
'triggers',(select jsonb_agg(jsonb_build_object('table',c.oid::regclass::text,'definition',pg_get_triggerdef(t.oid))) from pg_trigger t join pg_class c on t.tgrelid=c.oid join pg_namespace n on c.relnamespace=n.oid where n.nspname in ('public','auth') and not t.tgisinternal),
'grants',(select jsonb_agg(to_jsonb(g)) from (select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role')) g)
) as schema_snapshot;
