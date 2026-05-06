/**
 * FITSTATION 24 — Apps Script
 * --------------------------------------------------------------
 * วาง code นี้ใน Extensions → Apps Script ของ Google Sheets
 * แล้วเลือก function "installTriggers" กด Run ครั้งเดียว
 * (อนุญาตสิทธิ์ตามที่ Google ขอ)
 *
 * ช่อง LINE Channel Access Token / Group ID / รหัสเมเนเจอร์
 * ตั้งค่าในชีต Settings (ห้ามแก้ไขชื่อชีต/หัวคอลัมน์)
 * --------------------------------------------------------------
 */

const TZ = 'Asia/Bangkok';

// ========== ENTRY POINT: เรียกฟังก์ชันนี้ครั้งเดียวหลังวาง code ==========
function installTriggers() {
  // ลบ trigger เก่าก่อน
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1) onEdit installable trigger (รับ event แม้ในกรณีที่ user ไม่ใช่เจ้าของ)
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create();

  // 2) onOpen — log การเข้าใช้
  ScriptApp.newTrigger('handleOpen').forSpreadsheet(ss).onOpen().create();

  // 3) ทุกวัน 00:00 — สร้างการแจ้งเตือนสมาชิกใกล้หมดอายุ + ส่ง LINE OA
  ScriptApp.newTrigger('runDailyAtMidnight').timeBased().everyDays(1).atHour(0).inTimezone(TZ).create();

  // 4) ทุกวัน 21:00 — ส่งสรุปยอดเข้า LINE Group ของแต่ละสาขา
  ScriptApp.newTrigger('sendDailySummaryToGroups').timeBased().everyDays(1).atHour(21).inTimezone(TZ).create();

  SpreadsheetApp.getUi().alert('ติดตั้ง Trigger เรียบร้อยแล้ว ✓\n\n• onEdit (ส่ง LINE เมื่อแนบสลิป + ตรวจรหัสเทรน)\n• 00:00 — แจ้งเตือนสมาชิก/เทรนใกล้หมด\n• 21:00 — สรุปยอดเข้า LINE Group');
}

// ========== Helpers: อ่าน Settings ==========

function getConfig_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Settings');
  if (!sh) throw new Error('ไม่พบชีต Settings');

  // Branches (rows 6..10, cols B..G)
  const branchRange = sh.getRange('B6:G10').getValues();
  const branches = {};
  branchRange.forEach(row => {
    const [code, name, token, groupId, mgrEmail, mgrPwd] = row;
    if (code && String(code).trim()) {
      branches[String(code).trim()] = {
        code: String(code).trim(),
        name: String(name || '').trim(),
        token: String(token || '').trim(),
        groupId: String(groupId || '').trim(),
        managerEmail: String(mgrEmail || '').trim().toLowerCase(),
        managerPwd: String(mgrPwd || '').trim(),
      };
    }
  });

  // Global (rows 13..18, col C = value)
  const get = r => sh.getRange(r, 3).getValue();
  return {
    branches,
    timezone:        get(13) || TZ,
    expiryWarnDays:  Number(get(14)) || 15,
    trainerWarnHrs:  Number(get(15)) || 3,
    midnightTime:    String(get(16) || '00:00'),
    summaryTime:     String(get(17) || '21:00'),
    currency:        String(get(18) || '฿'),
  };
}

function logAlert_(type, branch, memberId, memberName, value, message, status) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Alerts');
  sh.appendRow([
    new Date(), type, branch, memberId, memberName, value, message, status || 'Sent'
  ]);
}

function logLogin_(action) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Login_Log');
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) return;
  // ดึง Role และสาขา จาก Employees
  const emp = ss.getSheetByName('Employees').getDataRange().getValues();
  let role = '', branch = '';
  for (let i = 2; i < emp.length; i++) {
    if (String(emp[i][6] || '').toLowerCase() === email) {
      role = emp[i][4]; branch = emp[i][5]; break;
    }
  }
  sh.appendRow([new Date(), email, role, branch, action]);
}

// ========== LINE Messaging API ==========

function linePushText_(token, to, text) {
  if (!token || !to) return false;
  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = {
    to: to,
    messages: [{ type: 'text', text: String(text).slice(0, 4900) }]
  };
  const opts = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  const res = UrlFetchApp.fetch(url, opts);
  const ok = res.getResponseCode() === 200;
  if (!ok) console.error('LINE error', res.getResponseCode(), res.getContentText());
  return ok;
}

function lineGetQuota_(token) {
  if (!token) return null;
  const headers = { 'Authorization': 'Bearer ' + token };
  const opts = { method: 'get', headers: headers, muteHttpExceptions: true };
  try {
    const q = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/quota', opts);
    const c = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/quota/consumption', opts);
    if (q.getResponseCode() !== 200 || c.getResponseCode() !== 200) {
      return { error: 'HTTP ' + q.getResponseCode() + '/' + c.getResponseCode(), body: q.getContentText() + ' | ' + c.getContentText() };
    }
    const quota = JSON.parse(q.getContentText());
    const cons  = JSON.parse(c.getContentText());
    return {
      type: quota.type,
      limit: quota.value || 0,
      used: cons.totalUsage || 0,
    };
  } catch (err) {
    return { error: String(err) };
  }
}

function menuCheckLineQuota() {
  const ui = SpreadsheetApp.getUi();
  const cfg = getConfig_();
  const codes = Object.keys(cfg.branches);
  if (codes.length === 0) { ui.alert('ยังไม่ได้ตั้งสาขาใน Settings'); return; }
  const lines = ['📊 สถานะโควต้า LINE ของแต่ละสาขา', ''];
  codes.forEach(code => {
    const b = cfg.branches[code];
    if (!b.token) {
      lines.push(`• ${code} — ${b.name}\n   ⚠️ ไม่มี token`);
      return;
    }
    const r = lineGetQuota_(b.token);
    if (!r) {
      lines.push(`• ${code} — ${b.name}\n   ⚠️ ไม่มี token`);
    } else if (r.error) {
      lines.push(`• ${code} — ${b.name}\n   ❌ ${r.error}`);
    } else {
      const limit = r.type === 'limited' ? r.limit : 'ไม่จำกัด';
      const remain = r.type === 'limited' ? Math.max(0, r.limit - r.used) : '-';
      const pct = r.type === 'limited' && r.limit > 0 ? ` (${Math.round(r.used / r.limit * 100)}%)` : '';
      lines.push(`• ${code} — ${b.name}\n   ใช้ไป: ${r.used}${pct} / เพดาน: ${limit} / เหลือ: ${remain}`);
    }
  });
  lines.push('', '* นับเฉพาะ push messages ของเดือนปัจจุบัน');
  ui.alert(lines.join('\n'));
}

function linePushFlex_(token, to, flexJson, altText) {
  if (!token || !to) return false;
  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = {
    to: to,
    messages: [{ type: 'flex', altText: altText || 'การแจ้งเตือน', contents: flexJson }]
  };
  const opts = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  const res = UrlFetchApp.fetch(url, opts);
  const ok = res.getResponseCode() === 200;
  if (!ok) console.error('LINE flex error', res.getResponseCode(), res.getContentText());
  return ok;
}

// ========== onOpen: log การเข้าใช้ + เมนู ==========

function handleOpen(e) {
  try { logLogin_('OPEN'); } catch (err) { console.error(err); }
  SpreadsheetApp.getUi()
    .createMenu('FITSTATION 24')
    .addItem('ติดตั้ง Triggers (ครั้งแรก)', 'installTriggers')
    .addItem('ทดสอบส่ง LINE (สาขาเลือก)', 'menuTestLine')
    .addItem('เช็คโควต้า LINE ทุกสาขา', 'menuCheckLineQuota')
    .addItem('สรุปยอดวันนี้ → LINE Group', 'sendDailySummaryToGroups')
    .addItem('สแกนสมาชิกใกล้หมดอายุตอนนี้', 'runDailyAtMidnight')
    .addToUi();
}

function menuTestLine() {
  const ui = SpreadsheetApp.getUi();
  const cfg = getConfig_();
  const codes = Object.keys(cfg.branches);
  if (codes.length === 0) { ui.alert('ยังไม่ได้ตั้งสาขาใน Settings'); return; }
  const pick = ui.prompt('ทดสอบส่ง LINE', 'พิมพ์รหัสสาขา (' + codes.join(', ') + ')', ui.ButtonSet.OK_CANCEL);
  if (pick.getSelectedButton() !== ui.Button.OK) return;
  const code = pick.getResponseText().trim();
  const b = cfg.branches[code];
  if (!b) { ui.alert('ไม่พบสาขา'); return; }
  const ok = linePushText_(b.token, b.groupId, '✅ ทดสอบการเชื่อมต่อ FITSTATION 24 — ' + b.name + '\nเวลา: ' + Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy HH:mm'));
  ui.alert(ok ? 'ส่งสำเร็จ' : 'ส่งไม่สำเร็จ — ตรวจ token/group id');
}

// ========== onEdit handler: ทริกเกอร์เมื่อมีการแก้ชีต ==========

function handleEdit(e) {
  try {
    const sheet = e.range.getSheet();
    const name  = sheet.getName();

    if (name === 'Sales')      onEditSales_(e);
    else if (name === 'Trainings') onEditTrainings_(e);
  } catch (err) {
    console.error('handleEdit error', err);
  }
}

// --- Sales: เมื่อแถวมียอด + แนบสลิป → ส่งเข้า LINE Group ---
function onEditSales_(e) {
  const sh = e.range.getSheet();
  const row = e.range.getRow();
  if (row < 3) return; // header

  const vals = sh.getRange(row, 2, 1, 11).getValues()[0];
  // [Timestamp, สาขา, EmpID, ประเภท, MemberID, ชื่อสมาชิก, จำนวนเงิน, สลิปURL, หมายเหตุ, LINENotify, Notifyเวลา]
  const [ts, branch, emp, type, memId, memName, amount, slip, note, notifyStatus] = vals;

  // เติม Timestamp อัตโนมัติถ้ายังว่าง และมีข้อมูลในบรรทัดแล้ว
  if (!ts && (branch || type)) {
    sh.getRange(row, 2).setValue(new Date());
  }

  // ส่ง LINE เฉพาะกรณี: ประเภท MEM/PT + มี slip + ยังไม่ส่ง
  const needsSlip = type === 'MEM' || type === 'PT';
  if (!needsSlip) return;
  if (!slip) return;
  if (notifyStatus === 'Sent') return;

  const cfg = getConfig_();
  const b = cfg.branches[branch];
  if (!b) {
    sh.getRange(row, 12).setValue('Failed');
    sh.getRange(row, 13).setValue('ไม่พบสาขา ' + branch);
    return;
  }

  const text =
    `🧾 ยอดใหม่ — ${b.name}\n` +
    `ประเภท: ${type}\n` +
    `สมาชิก: ${memName || memId || '-'}\n` +
    `พนักงาน: ${emp}\n` +
    `ยอด: ${cfg.currency}${Number(amount).toLocaleString()}\n` +
    (note ? `หมายเหตุ: ${note}\n` : '') +
    `เวลา: ${Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy HH:mm')}\n` +
    `สลิป: ${slip}`;

  const ok = linePushText_(b.token, b.groupId, text);
  sh.getRange(row, 12).setValue(ok ? 'Sent' : 'Failed');
  sh.getRange(row, 13).setValue(new Date());
  if (sh.getRange(row, 13).getValue() instanceof Date) {
    sh.getRange(row, 13).setNumberFormat('dd mmm yyyy hh:mm');
  }
}

// --- Trainings: เมื่อ Manager Pwd ตรวจผ่าน → หักชั่วโมงสมาชิก 1 ครั้ง ---
function onEditTrainings_(e) {
  const sh = e.range.getSheet();
  const row = e.range.getRow();
  if (row < 3) return;

  // ปล่อยสูตร "ตรวจสอบ" เป็นคน calculate ก่อน — แล้วเรา re-read
  SpreadsheetApp.flush();

  const vals = sh.getRange(row, 2, 1, 9).getValues()[0];
  // [Timestamp, สาขา, MemberID, ชื่อสมาชิก, TrainerID, ชื่อเทรนเนอร์, MgrPwd, ตรวจสอบ, หมายเหตุ]
  const [ts, branch, memId, memName, trainerId, trainerName, mgrPwd, verify, note] = vals;

  // เติม timestamp ถ้ายังว่างและมีข้อมูล
  if (!ts && memId) sh.getRange(row, 2).setValue(new Date());

  if (verify !== '✓ Verified') return;
  // กันการหักซ้ำ — เก็บ flag ใน หมายเหตุว่าหักแล้ว
  if (note && String(note).indexOf('[deducted]') >= 0) return;
  if (!memId) return;

  const ms = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Members');
  const data = ms.getDataRange().getValues();
  // header at row 2 → cols: B..M = 0..11 with offset 1 (since col A is empty)
  // เราอ่าน A1-based → ค้นหา MemberID ในคอลัมน์ B (index 1)
  for (let i = 2; i < data.length; i++) {
    if (String(data[i][1]) === String(memId)) {
      const hoursCol = 10; // คอลัมน์ J (ชม.เทรนคงเหลือ) = index 9 in 0-based, but our data starts col A so index 9
      const cur = Number(data[i][9] || 0);
      if (cur <= 0) {
        sh.getRange(row, 9).setValue('✗ ชม.หมด');
        return;
      }
      const newVal = cur - 1;
      ms.getRange(i + 1, 10).setValue(newVal); // row i+1 (1-based), col 10 = J
      const newNote = (note || '') + ' [deducted]';
      sh.getRange(row, 10).setValue(newNote);

      // แจ้งเตือน LINE OA ของสมาชิกถ้าเหลือ ≤ trainerWarnHrs
      const cfg = getConfig_();
      const b = cfg.branches[branch];
      const lineUid = data[i][10]; // คอลัมน์ K = LINE User ID (index 10)
      if (b && newVal <= cfg.trainerWarnHrs && lineUid) {
        const text = `🔔 ${b.name}\nคุณ${memName} เหลือชั่วโมงเทรน ${newVal} ครั้ง\nกรุณาติดต่อเคาน์เตอร์เพื่อต่ออายุได้ทันที`;
        linePushText_(b.token, lineUid, text);
        logAlert_('Trainer Hours Low', branch, memId, memName, newVal, text, 'Sent');
      }
      return;
    }
  }
}

// ========== Time-based: 00:00 ทุกวัน ==========

function runDailyAtMidnight() {
  const cfg = getConfig_();
  const ms = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Members');
  const data = ms.getDataRange().getValues();

  // header: row 2 → start at i=2 (third row = first data)
  // cols: A empty, B=MemberID(1), C=ชื่อ(2), D=นามสกุล(3), E=อายุ(4), F=สาขา(5),
  //       G=วันสมัคร(6), H=วันหมดอายุ(7), I=วันคงเหลือ(8), J=ชม.เทรน(9),
  //       K=เทรนเนอร์(10), L=LINEUID(11), M=สถานะ(12)
  let alertsExpiring = 0, alertsLowHr = 0;
  const today = new Date();
  today.setHours(0,0,0,0);

  for (let i = 2; i < data.length; i++) {
    const memId = data[i][1];
    if (!memId) continue;
    const memName = (data[i][2] || '') + ' ' + (data[i][3] || '');
    const branch = data[i][5];
    const expiry = data[i][7];
    const hours  = Number(data[i][9] || 0);
    const lineUid = data[i][10];
    const status = data[i][12];

    if (status !== 'Active') continue;

    // วันหมดอายุใกล้
    if (expiry instanceof Date) {
      const daysLeft = Math.round((expiry.getTime() - today.getTime()) / (1000*60*60*24));
      if (daysLeft <= cfg.expiryWarnDays && daysLeft >= 0) {
        const b = cfg.branches[branch];
        const msg = `⏰ ${b ? b.name : 'FITSTATION 24'}\nคุณ${memName} สมาชิกจะหมดอายุในอีก ${daysLeft} วัน\n(หมดอายุ ${Utilities.formatDate(expiry, TZ, 'dd MMM yyyy')})\nต่ออายุได้ที่เคาน์เตอร์`;
        if (b && lineUid) linePushText_(b.token, lineUid, msg);
        logAlert_('Member Expiring', branch, memId, memName, daysLeft + ' วัน', msg, lineUid ? 'Sent' : 'No LINE');
        alertsExpiring++;
      }
    }

    // ชั่วโมงเทรนใกล้หมด (เผื่อกรณีลืมเช็ค)
    if (hours > 0 && hours <= cfg.trainerWarnHrs) {
      const b = cfg.branches[branch];
      const msg = `🔔 ${b ? b.name : 'FITSTATION 24'}\nคุณ${memName} เหลือชั่วโมงเทรน ${hours} ครั้ง`;
      if (b && lineUid) linePushText_(b.token, lineUid, msg);
      logAlert_('Trainer Hours Low', branch, memId, memName, hours, msg, lineUid ? 'Sent' : 'No LINE');
      alertsLowHr++;
    }
  }

  console.log('runDailyAtMidnight: expiring=' + alertsExpiring + ', lowHrs=' + alertsLowHr);
}

// ========== Time-based: 21:00 — สรุปเข้า LINE Group ของแต่ละสาขา ==========

function sendDailySummaryToGroups() {
  const cfg = getConfig_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sales = ss.getSheetByName('Sales').getDataRange().getValues();
  const trainings = ss.getSheetByName('Trainings').getDataRange().getValues();

  const today = new Date();
  today.setHours(0,0,0,0);
  const tomorrow = new Date(today.getTime() + 24*3600*1000);

  Object.values(cfg.branches).forEach(b => {
    if (!b.token || !b.groupId) return;
    let mem=0, pt=0, plan=0, total=0, count=0, train=0;
    for (let i = 2; i < sales.length; i++) {
      const ts = sales[i][1]; // col B
      if (!(ts instanceof Date)) continue;
      if (ts < today || ts >= tomorrow) continue;
      if (sales[i][2] !== b.code) continue;
      const amt = Number(sales[i][7] || 0);
      const type = sales[i][4];
      count++;
      if (type === 'MEM')  { mem += amt;  total += amt; }
      else if (type === 'PT')   { pt += amt;   total += amt; }
      else if (type === 'Plan') { plan += amt; total += amt; }
    }
    for (let i = 2; i < trainings.length; i++) {
      const ts = trainings[i][1];
      if (!(ts instanceof Date)) continue;
      if (ts < today || ts >= tomorrow) continue;
      if (trainings[i][2] !== b.code) continue;
      if (trainings[i][8] === '✓ Verified') train++;
    }

    const text =
      `📊 สรุปยอด ${b.name}\n` +
      `วันที่ ${Utilities.formatDate(today, TZ, 'dd MMM yyyy')}\n` +
      `———————————\n` +
      `• MEM:  ${cfg.currency}${mem.toLocaleString()}\n` +
      `• PT:   ${cfg.currency}${pt.toLocaleString()}\n` +
      `• Plan: ${cfg.currency}${plan.toLocaleString()}\n` +
      `• เทรน: ${train} ครั้ง\n` +
      `———————————\n` +
      `รวม: ${cfg.currency}${total.toLocaleString()} (${count} รายการ)`;

    linePushText_(b.token, b.groupId, text);
  });
}
