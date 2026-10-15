#!/usr/bin/env node
/*
 * ส่งรายงานผู้บริหารเข้า LINE กลุ่มผู้บริหาร — รันโดย GitHub Actions ทุกวัน 23:00 (.github/workflows/exec-report.yml)
 *   รายวัน: ทุกวัน · รายสัปดาห์: วันอาทิตย์ (จันทร์–อาทิตย์) · รายเดือน: วันสุดท้ายของเดือน
 *
 * env (ไม่บังคับ):
 *   KIND=daily|weekly|monthly  บังคับส่งรอบนั้น (ไม่สนกำหนดการ/ไม่สนว่าส่งไปแล้ว)
 *   DRY_RUN=true               แค่พิมพ์ข้อความ ไม่ส่ง LINE
 *
 * ค่า Supabase อ่านจาก index.html (anon key ตัวเดียวกับหน้าเว็บ) · LINE token / group id ของกลุ่มผู้บริหาร
 * ตั้งที่หน้าเว็บ: ตั้งค่าระบบ → รายงานผู้บริหาร (เก็บใน app_settings.global)
 */
process.env.TZ = process.env.TZ || 'Asia/Bangkok';

const fs = require('fs');
const path = require('path');
const ExecReport = require('../exec-report.js');

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

const headers = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init, headers: { ...headers, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${pathAndQuery.split('?')[0]}: HTTP ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function loadSales(from, to) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const q = `app_sales?select=ts,branch,type,amount,channel&ts=gte.${encodeURIComponent(from.toISOString())}`
      + `&ts=lt.${encodeURIComponent(to.toISOString())}&order=ts.asc&limit=1000&offset=${offset}`;
    const rows = await rest(q);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function main() {
  const dry = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
  const forced = (process.env.KIND || '').trim();
  if (forced && !ExecReport.KINDS[forced]) throw new Error('KIND ต้องเป็น daily / weekly / monthly');

  // GitHub cron อาจดีเลย์ข้ามเที่ยงคืน → ถ้ารันก่อน 06:00 ให้ถือเป็นรอบของเมื่อวาน
  const now = new Date();
  const ref = now.getHours() < 6 ? ExecReport.addDays(now, -1) : now;
  const kinds = forced ? [forced] : ExecReport.dueKinds(ref);

  const [settingsRows, branches, sentRows] = await Promise.all([
    rest('app_settings?select=value&key=eq.global'),
    rest('app_branches?select=code,name&order=code.asc'),
    rest(`app_settings?select=value&key=eq.${SENT_KEY}`),
  ]);
  const settings = (settingsRows[0] && settingsRows[0].value) || {};
  const sent = (sentRows[0] && sentRows[0].value) || {};

  const periods = kinds.map(k => ExecReport.periodFor(k, ref));
  const from = new Date(Math.min(...periods.map(p => p.prevStart)));
  const to = new Date(Math.max(...periods.map(p => p.end)));
  const sales = await loadSales(from, to);
  console.log(`ref=${ExecReport.isoDay(ref)} kinds=${kinds.join(',')} sales=${sales.length} dry=${dry}`);

  if (!dry && (!settings.execLineToken || !settings.execLineGroupId)) {
    console.log('ยังไม่ได้ตั้งค่า LINE กลุ่มผู้บริหาร (ตั้งค่าระบบ → รายงานผู้บริหาร) — ข้าม');
    return;
  }

  let changed = false;
  for (const kind of kinds) {
    const key = `${kind}|${ExecReport.isoDay(ref)}`;
    if (!forced && sent[key]) { console.log(`ข้าม ${key} (ส่งไปแล้ว)`); continue; }
    const text = ExecReport.build({
      kind, ref, sales, branches, currency: settings.currency, brand: settings.execBrand,
    });
    console.log(`\n----- ${key} -----\n${text}\n`);
    if (dry) continue;

    const res = await fetch(LINE_FUNCTION_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        branchCode: (branches[0] && branches[0].code) || 'EXEC',
        lineToken: settings.execLineToken,
        lineGroupId: settings.execLineGroupId,
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.ok) throw new Error(`ส่ง LINE (${key}) ไม่สำเร็จ: ${result.error || 'HTTP ' + res.status}`);
    console.log(`ส่ง ${key} แล้ว`);
    sent[key] = new Date().toISOString();
    changed = true;
  }

  if (changed) {
    const keep = Object.keys(sent).sort().slice(-120);   // เก็บประวัติแค่ช่วงหลัง ๆ
    const value = Object.fromEntries(keep.map(k => [k, sent[k]]));
    await rest('app_settings?on_conflict=key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key: SENT_KEY, value }),
    });
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
