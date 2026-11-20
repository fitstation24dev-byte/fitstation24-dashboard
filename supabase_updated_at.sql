-- ลดการใช้โควตา Supabase: เพิ่มคอลัมน์ updated_at ให้ทุกตารางที่แอปซิงค์
-- แอปจะจำข้อมูลไว้ในเครื่อง แล้วเปิดครั้งต่อไปดึงเฉพาะแถวที่เปลี่ยน (แทนการโหลดทั้งฐานทุกครั้ง)
-- รันครั้งเดียวใน Supabase → SQL Editor (รันซ้ำได้ ไม่เสียหาย)

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['app_branches','app_users','app_employees','app_members','app_sales',
                           'app_trainings','app_alerts','app_packages','app_classes'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('create index if not exists %I on public.%I (updated_at)', t || '_updated_at_idx', t);
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end $$;
