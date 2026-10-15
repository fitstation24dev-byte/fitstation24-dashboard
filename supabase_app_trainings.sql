-- ============================================================
-- ตาราง app_trainings — ให้ "บันทึกการเทรน" ขึ้นคลาวด์ ทุกเครื่องเห็นเหมือนกัน
-- อาการก่อนแก้: แอปอ่านตารางนี้ได้ 0 แถวเสมอ (สิทธิ์ RLS / คอลัมน์ไม่ครบ) → การเทรนอยู่แค่ในเครื่องที่บันทึก
-- วิธีใช้: เปิด Supabase → โปรเจกต์ของคุณ → SQL Editor → วางทั้งหมดนี้ → กด Run
-- รันครั้งเดียวพอ (คำสั่งเป็นแบบปลอดภัย รันซ้ำได้ไม่พัง ไม่ลบข้อมูลเดิม)
-- ============================================================

create table if not exists public.app_trainings (
  id            text primary key,
  ts            timestamptz,
  branch        text,
  member_id     text,
  member_name   text,
  trainer_id    text,
  trainer_name  text,
  verified      boolean default true,
  hours_before  integer,
  hours_after   integer
);

-- ถ้าตารางเคยถูกสร้างไว้แต่คอลัมน์ไม่ครบ — เติมให้ครบตามที่แอปใช้
alter table public.app_trainings add column if not exists ts            timestamptz;
alter table public.app_trainings add column if not exists branch        text;
alter table public.app_trainings add column if not exists member_id     text;
alter table public.app_trainings add column if not exists member_name   text;
alter table public.app_trainings add column if not exists trainer_id    text;
alter table public.app_trainings add column if not exists trainer_name  text;
alter table public.app_trainings add column if not exists verified      boolean default true;
alter table public.app_trainings add column if not exists hours_before  integer;
alter table public.app_trainings add column if not exists hours_after   integer;

-- เปิด Row Level Security + อนุญาตให้แอปอ่าน/เขียนได้ (ให้ตรงกับตารางอื่น เช่น app_sales, app_classes)
alter table public.app_trainings enable row level security;

drop policy if exists "app_trainings all access" on public.app_trainings;
create policy "app_trainings all access"
  on public.app_trainings for all
  using (true) with check (true);

-- เปิด Realtime เพื่อให้หลายเครื่องเห็นการเทรนใหม่ทันที (ถ้าเคยเพิ่มแล้วจะข้ามให้เอง)
do $$
begin
  alter publication supabase_realtime add table public.app_trainings;
exception when duplicate_object then
  null;
end $$;

-- ตรวจผล: ควรเห็นจำนวนแถว (ถ้าเพิ่งแก้ อาจเป็น 0 จนกว่าจะมีเครื่องที่มีข้อมูลเปิดแอป)
select count(*) as trainings_in_cloud from public.app_trainings;
