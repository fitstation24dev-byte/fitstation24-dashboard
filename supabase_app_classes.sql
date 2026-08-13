-- ============================================================
-- ตาราง app_classes — ซิงค์ "ตารางคลาส" ขึ้นคลาวด์ (Supabase)
-- วิธีใช้: เปิด Supabase → โปรเจกต์ของคุณ → SQL Editor → วางทั้งหมดนี้ → กด Run
-- รันครั้งเดียวพอ (คำสั่งเป็นแบบปลอดภัย รันซ้ำได้ไม่พัง)
-- ============================================================

create table if not exists public.app_classes (
  id          text primary key,
  name        text,
  day         smallint,
  start_time  text,
  end_time    text,
  trainer     text,
  room        text,
  capacity    text,
  level       text,
  color       text,
  icon        text,
  note        text,
  branch      text
);

-- เปิด Row Level Security + อนุญาตให้แอปเข้าถึงได้ (ให้ตรงกับตารางอื่น เช่น app_packages)
alter table public.app_classes enable row level security;

drop policy if exists "app_classes all access" on public.app_classes;
create policy "app_classes all access"
  on public.app_classes for all
  using (true) with check (true);

-- เปิด Realtime เพื่อให้หลายเครื่องซิงค์กันทันที (ถ้าเคยเพิ่มแล้วจะขึ้น error ข้ามได้)
do $$
begin
  alter publication supabase_realtime add table public.app_classes;
exception when duplicate_object then
  null;
end $$;
