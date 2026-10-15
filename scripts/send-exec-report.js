#!/usr/bin/env node
/*
 * ส่งรายงานสรุปยอดเข้า LINE — รันโดย GitHub Actions (.github/workflows/exec-report.yml)
 *   JOB=morning (08:00): สรุปผลรายวันของเมื่อวาน → กลุ่ม LINE ของแต่ละสาขา (ยอดรายคน + เทรน)
 *   JOB=evening (23:00): รายงานผู้บริหาร → กลุ่มผู้บริหาร (รายวันทุกวัน · รายสัปดาห์วันที่ 7/14/21/สิ้นเดือน · รายเดือนวันสิ้นเดือน;
 *                        เปิด/ปิดแต่ละรอบได้ที่ ตั้งค่าระบบ → settings.execKinds)
 *                        + วันสิ้นเดือน: สรุปรายเดือนของแต่ละสาขา → กลุ่มสาขา (ยอด + ช่องทาง + จำนวนเทรน)
 *
 * env (ไม่บังคับ):
 *   JOB=morning|evening      ไม่ระบุ = เดาจากเวลา (ก่อนเที่ยง = morning)
 *   REPORT=exec-daily|exec-weekly|exec-monthly|branch-daily|branch-monthly
 *                            บังคับส่งเฉพาะรายงานนั้น (ไม่สนกำหนดการ/ไม่สนว่าส่งไปแล้ว)
 *   DRY_RUN=true             แค่พิมพ์ข้อความ ไม่ส่ง LINE ไม่บันทึกอะไร
 *
 * ค่า Supabase อ่านจาก index.html (anon key ตัวเดียวกับหน้าเว็บ)
 * LINE: กลุ่มสาขาใช้ token/group ของสาขา (app_branches) · กลุ่มผู้บริหารตั้งที่ ตั้งค่าระบบ → รายงานผู้บริหาร
 */
process.env.TZ = process.env.TZ || 'Asia/Bangkok';

const fs = require('fs');
const path = require('path');
const R = require('../exec-report.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const pick = (name) => {
  const m = html.match(new RegExp(`const ${name} = '([^']+)'`));
  if (!m) throw new Error(`หา ${name} ใน index.html ไม่เจอ`);
  return m[1];
};
const SUPABASE_URL = pick('SUPABASE_URL');
const SUPABASE_KEY = pick('SUPABASE_KEY');
const LINE_FUNCTION_URL = SUPABASE_URL + '/functions/v1/swift-handler';
const SENT_KEY = 'exec_report_sent';   // แถวแยกใน app_settings — ไม่ชนกับ settings.global ที่หน้าเว็บเขียนทับทั้งก้อน
const REPORTS = ['exec-daily', 'exec-weekly', 'exec-monthly', 'branch-daily', 'branch-monthly'];

const headers = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init, headers: { ...headers, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${pathAndQuery.split('?')[0]}: HTTP ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function loadRange(table, select, from, to) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const q = `${table}?select=${select}&ts=gte.${encodeURIComponent(from.toISOString())}`
      + `&ts=lt.${encodeURIComponent(to.toISOString())}&order=ts.asc&limit=1000&offset=${offset}`;
    const rows = await rest(q);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function sendLine(text, branchCode, lineToken, lineGroupId) {
  const res = await fetch(LINE_FUNCTION_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text, branchCode, lineToken, lineGroupId }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || !result.ok) throw new Error(result.error || 'HTTP ' + res.status);
}

async function main() {
  const dry = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
  const forced = (process.env.REPORT || '').trim();
  if (forced && !REPORTS.includes(forced)) throw new Error('REPORT ต้องเป็น ' + REPORTS.join(' / '));

  const now = new Date();
  const job = forced ? (forced === 'branch-daily' ? 'morning' : 'evening')
    : (process.env.JOB || (now.getHours() < 12 ? 'morning' : 'evening'));
  // GitHub cron อาจดีเลย์ข้ามเที่ยงคืน → รอบค่ำที่รันก่อน 06:00 ถือเป็นของเมื่อวาน
  const evening = job === 'evening' && now.getHours() < 6 ? R.addDays(now, -1) : now;
  const yesterday = R.addDays(now, -1);

  // รายการที่ต้องส่งรอบนี้: { id, key (กันส่งซ้ำ), build(data) → [{ text, to }] }
  let plan;
  if (job === 'morning') {
    plan = ['branch-daily'];
  } else {
    plan = R.dueKinds(evening).map(k => 'exec-' + k);
    if (R.isLastDayOfMonth(evening)) plan.push('branch-monthly');
  }
  if (forced) plan = [forced];

  const ref = (id) => id === 'branch-daily' ? yesterday : evening;
  const period = (id) => {
    if (id === 'branch-daily') return R.periodFor('daily', yesterday);
    if (id === 'branch-monthly') return R.periodFor('monthly', evening);
    return R.periodFor(id.replace('exec-', ''), evening);
  };
  const from = new Date(Math.min(...plan.map(id => period(id).prevStart)));
  const to = new Date(Math.max(...plan.map(id => period(id).end)));

  const [settingsRows, branches, sentRows, employees, salesRows, trainRows] = await Promise.all([
    rest('app_settings?select=value&key=eq.global'),
    rest('app_branches?select=code,name,line_token,line_group_id&order=code.asc'),
    rest(`app_settings?select=value&key=eq.${SENT_KEY}`),
    rest('app_employees?select=id,name,surname'),
    loadRange('app_sales', 'ts,branch,emp_id,type,amount,channel,splits', from, to),
    loadRange('app_trainings', 'ts,branch,trainer_id,verified', from, to),
  ]);
  const settings = (settingsRows[0] && settingsRows[0].value) || {};
  const sent = (sentRows[0] && sentRows[0].value) || {};
  const sales = salesRows.map(s => ({ ...s, empId: s.emp_id }));
  const trainings = trainRows.map(t => ({ ...t, trainerId: t.trainer_id }));
  const cur = settings.currency;
  console.log(`job=${job} reports=${plan.join(',')} sales=${sales.length} trainings=${trainings.length} dry=${dry}`);

  // แตกเป็นข้อความที่ต้องส่ง พร้อม key กันส่งซ้ำ
  const messages = [];
  for (const id of plan) {
    if (id.startsWith('exec-')) {
      const kind = id.replace('exec-', '');
      // ผู้ใช้ปิดรอบนี้ไว้ (ตั้งค่าระบบ → รายงานผู้บริหาร → ส่งอัตโนมัติ) — ยกเว้นสั่งส่งตรง ๆ ด้วย REPORT
      if (!forced && settings.execKinds && settings.execKinds[kind] === false) {
        console.log(`ข้าม exec-${kind} (ปิดการส่งอัตโนมัติไว้)`);
        continue;
      }
      messages.push({
        key: `${kind}|${R.isoDay(evening)}`,   // รูปแบบ key เดิมของรายงานผู้บริหาร
        text: R.build({ kind, ref: evening, sales, branches, currency: cur, brand: settings.execBrand }),
        to: { branchCode: (branches[0] && branches[0].code) || 'EXEC', token: settings.execLineToken, group: settings.execLineGroupId, label: 'กลุ่มผู้บริหาร' },
      });
    } else {
      for (const b of branches) {
        const text = id === 'branch-daily'
          ? R.buildBranchDaily({ day: yesterday, branch: b, sales, trainings, employees, currency: cur })
          : R.buildBranchMonthly({ ref: evening, branch: b, sales, trainings, currency: cur });
        if (!text) { console.log(`${id} ${b.code}: ไม่มียอด — ข้าม`); continue; }
        const stamp = id === 'branch-daily' ? R.isoDay(ref(id)) : R.isoDay(ref(id)).slice(0, 7);
        messages.push({
          key: `${id}|${b.code}|${stamp}`, text,
          to: { branchCode: b.code, token: b.line_token, group: b.line_group_id, label: 'สาขา ' + b.code },
        });
      }
    }
  }

  let changed = false, failed = 0;
  for (const m of messages) {
    if (!forced && sent[m.key]) { console.log(`ข้าม ${m.key} (ส่งไปแล้ว)`); continue; }
    console.log(`\n----- ${m.key} → ${m.to.label} -----\n${m.text}\n`);
    if (dry) continue;
    if (!m.to.token || !m.to.group) { console.log(`ข้าม ${m.key}: ${m.to.label} ยังไม่ได้ตั้ง LINE Token / Group ID`); continue; }
    try {
      await sendLine(m.text, m.to.branchCode, m.to.token, m.to.group);
      console.log(`ส่ง ${m.key} แล้ว`);
      sent[m.key] = new Date().toISOString();
      changed = true;
    } catch (err) {
      failed++;
      console.error(`ส่ง ${m.key} ไม่สำเร็จ: ${err.message || err}`);
    }
  }

  if (changed) {
    const keep = Object.keys(sent).sort((a, b) => String(sent[a]).localeCompare(String(sent[b]))).slice(-300);
    const value = Object.fromEntries(keep.map(k => [k, sent[k]]));
    await rest('app_settings?on_conflict=key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key: SENT_KEY, value }),
    });
  }
  if (failed) throw new Error(`ส่งไม่สำเร็จ ${failed} รายการ (ดู log ด้านบน)`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
