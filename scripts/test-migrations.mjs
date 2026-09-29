// 마이그레이션 검증: 실제 Postgres(pglite, WASM)에 Supabase 스텁(auth.users·auth.uid()·storage.buckets/objects·roles)을 만들고
// supabase/migrations/*.sql 을 순서대로 각 2회 실행(멱등 확인) + 제약 동작 확인. PR 전에 결과를 보고서에 첨부한다.
//   사용: npm i --no-save @electric-sql/pglite && node scripts/test-migrations.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.cwd(), "supabase/migrations");
const db = new PGlite({ extensions: { pgcrypto } });
const UID = "00000000-0000-0000-0000-000000000001";
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text, is_anonymous boolean default true);
  create or replace function auth.uid() returns uuid language sql stable as $$ select '${UID}'::uuid $$;
  create or replace function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table if not exists storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid);
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  insert into auth.users (id, email) values ('${UID}', null) on conflict do nothing;
`);
let failed = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  for (const run of [1, 2]) {
    try { await db.exec(sql); console.log(`${f} run${run}: OK`); }
    catch (e) { failed++; console.log(`${f} run${run}: FAIL ${e.message.split("\n")[0]}`); }
  }
}
// 0004 제약 확인
const check = async (label, sql, expectOk) => {
  try { await db.exec(sql); console.log(`${label}: ${expectOk ? "OK" : "FAIL(허용됨)"}`); if (!expectOk) failed++; }
  catch (e) { console.log(`${label}: ${expectOk ? "FAIL " + e.message.split("\n")[0] : "OK(거부: " + e.message.split("\n")[0] + ")"}`); if (expectOk) failed++; }
};
await check("insert tags 2개·hp 50", `insert into public.my_pokemon(user_id,species_id,form,name_kr,tags,hp) values ('${UID}',1,'Normal','x','{"a","b"}',50)`, true);
await check("tags 9개 거부", `insert into public.my_pokemon(user_id,species_id,form,name_kr,tags) values ('${UID}',1,'Normal','x','{"a","b","c","d","e","f","g","h","i"}')`, false);
await check("tag 25자 거부", `insert into public.my_pokemon(user_id,species_id,form,name_kr,tags) values ('${UID}',1,'Normal','x','{"${"가".repeat(25)}"}')`, false);
await check("hp 5 거부", `insert into public.my_pokemon(user_id,species_id,form,name_kr,hp) values ('${UID}',1,'Normal','x',5)`, false);
await check("caught_on date", `insert into public.my_pokemon(user_id,species_id,form,name_kr,caught_on) values ('${UID}',1,'Normal','x','2016-08-01')`, true);
// 0005 스캔 기록: 같은 세션·같은 개체는 unique, cleanup 함수
await check("scan_items insert", `insert into public.scan_items(user_id,session_id,scan_key,species_id,name_kr,cp,hp) values ('${UID}','s1','815|Normal|3002|161|15|14|14|0',815,'에이스번',3002,161)`, true);
await check("scan_items 같은 세션·개체 중복 거부", `insert into public.scan_items(user_id,session_id,scan_key,species_id,name_kr) values ('${UID}','s1','815|Normal|3002|161|15|14|14|0',815,'에이스번')`, false);
await check("cleanup_scan_items()", `select public.cleanup_scan_items()`, true);
await check("scan_sessions upsert", `insert into public.scan_sessions(user_id,session_id,metrics) values ('${UID}','s1','{"frames":10}') on conflict (user_id,session_id) do update set metrics = excluded.metrics`, true);
await check("cleanup_scan_items() (세션 포함)", `select public.cleanup_scan_items()`, true);
await check("0007 game_tags 저장", `insert into public.scan_items(user_id,session_id,scan_key,species_id,name_kr,game_tags) values ('${UID}','s2','k1',700,'님피아','{"슈퍼리그"}')`, true);
await check("0007 game_tags 9개 거부", `insert into public.my_pokemon(user_id,species_id,form,name_kr,game_tags) values ('${UID}',1,'Normal','x','{"a","b","c","d","e","f","g","h","i"}')`, false);
// 0008 superseded
await check("0008 superseded 기본 false", `insert into public.scan_items(user_id,session_id,scan_key,species_id,name_kr) values ('${UID}','s3','k3',979,'저승갓숭')`, true);
const sup = await db.query(`select superseded, superseded_by from public.scan_items where session_id='s3'`);
console.log(`0008 superseded 기본값: ${sup.rows[0]?.superseded === false && sup.rows[0]?.superseded_by == null ? "OK" : "FAIL"}`); if (!(sup.rows[0]?.superseded === false)) failed++;
await check("0008 superseded_by 자기참조", `update public.scan_items set superseded = true, superseded_by = (select id from public.scan_items where session_id='s2' limit 1) where session_id='s3'`, true);
await check("0008 superseded_by 없는 id 거부", `update public.scan_items set superseded_by = '00000000-0000-0000-0000-00000000dead' where session_id='s3'`, false);
// 0009 user_settings
await check("0009 user_settings upsert", `insert into public.user_settings(user_id, storage_mode) values ('${UID}','relaxed') on conflict (user_id) do update set storage_mode = excluded.storage_mode, updated_at = now()`, true);
await check("0009 storage_mode 잘못된 값 거부", `update public.user_settings set storage_mode = 'huge' where user_id = '${UID}'`, false);
await check("0009 scan_backfill_version 저장", `update public.user_settings set scan_backfill_version = '2026-09-29.4' where user_id = '${UID}'`, true);
// 0010 recheck_reason
await check("0010 recheck_reason 저장", `update public.scan_items set recheck = true, recheck_reason = '같은 CP·HP 다른 개체값 — 재스캔 필요' where session_id = 's3'`, true);
// 0011 app_version / is_purified / dismissed_reason
await check("0011 app_version·is_purified 저장", `insert into public.scan_items(user_id,session_id,scan_key,species_id,name_kr,app_version,is_purified) values ('${UID}','s4','k4',396,'찌르꼬','0.1.38',true)`, true);
await check("0011 dismissed_reason 저장", `update public.scan_items set dismissed = true, dismissed_reason = 'before_session' where session_id = 's4'`, true);
const idx = await db.query(`select indexname from pg_indexes where tablename='my_pokemon' and indexname like '%tags%'`);
console.log("tags index:", idx.rows.map((r) => r.indexname).join(", ") || "없음");
console.log(failed ? `FAILED ${failed}` : "ALL OK");
process.exit(failed ? 1 : 0);
