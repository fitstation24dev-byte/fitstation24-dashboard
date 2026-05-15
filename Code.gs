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
    .addItem('📝 สมัครสมาชิกใหม่', 'menuOpenMemberRegistration')
    .addSeparator()
    .addItem('ติดตั้ง Triggers (ครั้งแรก)', 'installTriggers')
    .addItem('เตรียมคอลัมน์สมัครสมาชิก (ครั้งแรก)', 'setupMemberRegistration')
    .addItem('ทดสอบส่ง LINE (สาขาเลือก)', 'menuTestLine')
    .addItem('เช็คโควต้า LINE ทุกสาขา', 'menuCheckLineQuota')
    .addItem('สรุปยอดวันนี้ → LINE Group', 'menuSendSummaryToday')
    .addItem('สรุปยอดเมื่อวาน → LINE Group', 'menuSendSummaryYesterday')
    .addItem('สแกนสมาชิกใกล้หมดอายุตอนนี้', 'menuRunExpiryScan')
    .addToUi();
}

function menuSendSummaryToday() {
  _runSummaryWithUi_(new Date(), 'วันนี้');
}

function menuSendSummaryYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  _runSummaryWithUi_(d, 'เมื่อวาน');
}

function _runSummaryWithUi_(targetDate, label) {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = sendDailySummaryToGroups(targetDate);
    const dateStr = Utilities.formatDate(r.date, TZ, 'dd MMM yyyy');
    let lines = ['สรุปยอด ' + label + ' (' + dateStr + ')',
      '────────────────',
      'สาขาทั้งหมด: ' + r.total,
      '• ส่งสำเร็จ: ' + r.sent,
      '• ส่งไม่สำเร็จ: ' + r.failed,
      '• ข้าม (ขาด Token/Group): ' + r.skipped,
      ''];
    r.details.forEach(d => {
      if (d.status === 'Sent') {
        lines.push('✓ ' + d.code + ' ' + d.name + ' — ' + d.count + ' รายการ, รวม ' + (d.total || 0).toLocaleString());
      } else if (d.status === 'Failed') {
        lines.push('✗ ' + d.code + ' ' + d.name + ' — ส่งไม่สำเร็จ (เช็ค token/groupId)');
      } else {
        lines.push('⊘ ' + d.code + ' ' + d.name + ' — ' + (d.reason || 'ข้าม'));
      }
    });
    if (r.total === 0) lines.push('ยังไม่ได้ตั้งสาขาใน Settings (B6:G10)');
    ui.alert(lines.join('\n'));
  } catch (err) {
    ui.alert('เกิดข้อผิดพลาด: ' + err.message);
    console.error(err);
  }
}

function menuRunExpiryScan() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = runDailyAtMidnight();
    let lines = ['สแกนสมาชิกใกล้หมดอายุ / เทรนใกล้หมด',
      '────────────────',
      'สมาชิกทั้งหมด: ' + r.scanned + ' (Active: ' + r.active + ')',
      '',
      '⏰ ใกล้หมดอายุ: พบ ' + r.expiringFound + ' คน',
      '  • ส่ง LINE สำเร็จ: ' + r.expiringSent,
      '  • ไม่มี LINE UID: ' + r.expiringNoLine,
      '',
      '🔔 ชั่วโมงเทรนใกล้หมด: พบ ' + r.lowHrFound + ' คน',
      '  • ส่ง LINE สำเร็จ: ' + r.lowHrSent,
      '  • ไม่มี LINE UID: ' + r.lowHrNoLine];
    const perBranchKeys = Object.keys(r.perBranch);
    if (perBranchKeys.length > 0) {
      lines.push('', 'แยกตามสาขา:');
      perBranchKeys.forEach(k => {
        const pb = r.perBranch[k];
        lines.push('• ' + k + ' ' + pb.name + ' — หมดอายุ ' + pb.expiring + ', เทรนต่ำ ' + pb.lowHr);
      });
    }
    const missKeys = Object.keys(r.branchMissing);
    if (missKeys.length > 0) {
      lines.push('', '⚠ พบรหัสสาขาที่ไม่ตรงกับ Settings:');
      missKeys.forEach(k => lines.push('• "' + k + '" → ' + r.branchMissing[k] + ' คน'));
    }
    if (r.expiringFound === 0 && r.lowHrFound === 0) {
      lines.push('', 'ℹ ไม่มีสมาชิกเข้าเงื่อนไขแจ้งเตือนในตอนนี้',
        '  (expiryWarnDays=' + getConfig_().expiryWarnDays + ', trainerWarnHrs=' + getConfig_().trainerWarnHrs + ')');
    }
    ui.alert(lines.join('\n'));
  } catch (err) {
    ui.alert('เกิดข้อผิดพลาด: ' + err.message);
    console.error(err);
  }
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
  const branchKey = String(branch || '').trim();
  const b = cfg.branches[branchKey];
  if (!b) {
    sh.getRange(row, 12).setValue('Failed');
    sh.getRange(row, 13).setValue('ไม่พบสาขา ' + branchKey);
    return;
  }
  if (!b.token || !b.groupId) {
    sh.getRange(row, 12).setValue('Failed');
    sh.getRange(row, 13).setValue('สาขา ' + branchKey + ' ยังไม่ได้ตั้ง LINE Token/Group ใน Settings');
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
      const b = cfg.branches[String(branch || '').trim()];
      const lineUid = data[i][11]; // คอลัมน์ L = LINE User ID (index 11)
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
  const result = {
    scanned: 0, active: 0,
    expiringFound: 0, expiringSent: 0, expiringNoLine: 0,
    lowHrFound: 0, lowHrSent: 0, lowHrNoLine: 0,
    branchMissing: {},
    perBranch: {},
  };
  const today = new Date();
  today.setHours(0,0,0,0);

  for (let i = 2; i < data.length; i++) {
    const memId = data[i][1];
    if (!memId) continue;
    result.scanned++;
    const memName = (data[i][2] || '') + ' ' + (data[i][3] || '');
    const branchKey = String(data[i][5] || '').trim();
    const expiry = data[i][7];
    const hours  = Number(data[i][9] || 0);
    const lineUid = data[i][11]; // คอลัมน์ L = LINE User ID
    const status = String(data[i][12] || '').trim();

    if (status !== 'Active') continue;
    result.active++;

    const b = cfg.branches[branchKey];
    if (!b) {
      result.branchMissing[branchKey || '(ว่าง)'] = (result.branchMissing[branchKey || '(ว่าง)'] || 0) + 1;
      logAlert_('Config Missing', branchKey, memId, memName, '-', 'ไม่พบสาขา ' + branchKey + ' ใน Settings', 'Skipped');
      continue;
    }
    if (!result.perBranch[b.code]) result.perBranch[b.code] = { name: b.name, expiring: 0, lowHr: 0 };

    // วันหมดอายุใกล้
    if (expiry instanceof Date) {
      const daysLeft = Math.round((expiry.getTime() - today.getTime()) / (1000*60*60*24));
      if (daysLeft <= cfg.expiryWarnDays && daysLeft >= 0) {
        const msg = `⏰ ${b.name}\nคุณ${memName} สมาชิกจะหมดอายุในอีก ${daysLeft} วัน\n(หมดอายุ ${Utilities.formatDate(expiry, TZ, 'dd MMM yyyy')})\nต่ออายุได้ที่เคาน์เตอร์`;
        if (lineUid) {
          linePushText_(b.token, lineUid, msg);
          result.expiringSent++;
        } else {
          result.expiringNoLine++;
        }
        logAlert_('Member Expiring', branchKey, memId, memName, daysLeft + ' วัน', msg, lineUid ? 'Sent' : 'No LINE');
        result.expiringFound++;
        result.perBranch[b.code].expiring++;
      }
    }

    // ชั่วโมงเทรนใกล้หมด (เผื่อกรณีลืมเช็ค)
    if (hours > 0 && hours <= cfg.trainerWarnHrs) {
      const msg = `🔔 ${b.name}\nคุณ${memName} เหลือชั่วโมงเทรน ${hours} ครั้ง`;
      if (lineUid) {
        linePushText_(b.token, lineUid, msg);
        result.lowHrSent++;
      } else {
        result.lowHrNoLine++;
      }
      logAlert_('Trainer Hours Low', branchKey, memId, memName, hours, msg, lineUid ? 'Sent' : 'No LINE');
      result.lowHrFound++;
      result.perBranch[b.code].lowHr++;
    }
  }

  console.log('runDailyAtMidnight: expiring=' + result.expiringFound + ', lowHrs=' + result.lowHrFound);
  return result;
}

// ========== Time-based: 21:00 — สรุปเข้า LINE Group ของแต่ละสาขา ==========

function sendDailySummaryToGroups(targetDate) {
  const cfg = getConfig_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sales = ss.getSheetByName('Sales').getDataRange().getValues();
  const trainings = ss.getSheetByName('Trainings').getDataRange().getValues();

  const dayStart = new Date(targetDate || new Date());
  dayStart.setHours(0,0,0,0);
  const dayEnd = new Date(dayStart.getTime() + 24*3600*1000);

  const branches = Object.values(cfg.branches);
  const result = { date: dayStart, total: branches.length, sent: 0, failed: 0, skipped: 0, details: [] };

  branches.forEach(b => {
    if (!b.token || !b.groupId) {
      const reason = 'ขาด LINE Token หรือ Group ID ใน Settings';
      logAlert_('Daily Summary', b.code, '-', '-', '-',
        'ข้ามสาขา ' + b.code + ' (' + b.name + ') — ' + reason, 'Skipped');
      result.skipped++;
      result.details.push({ code: b.code, name: b.name, status: 'Skipped', reason });
      return;
    }
    let mem=0, pt=0, plan=0, total=0, count=0, train=0;
    for (let i = 2; i < sales.length; i++) {
      const ts = sales[i][1]; // col B
      if (!(ts instanceof Date)) continue;
      if (ts < dayStart || ts >= dayEnd) continue;
      if (String(sales[i][2] || '').trim() !== b.code) continue;
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
      if (ts < dayStart || ts >= dayEnd) continue;
      if (String(trainings[i][2] || '').trim() !== b.code) continue;
      if (trainings[i][8] === '✓ Verified') train++;
    }

    const text =
      `📊 สรุปยอด ${b.name}\n` +
      `วันที่ ${Utilities.formatDate(dayStart, TZ, 'dd MMM yyyy')}\n` +
      `———————————\n` +
      `• MEM:  ${cfg.currency}${mem.toLocaleString()}\n` +
      `• PT:   ${cfg.currency}${pt.toLocaleString()}\n` +
      `• Plan: ${cfg.currency}${plan.toLocaleString()}\n` +
      `• เทรน: ${train} ครั้ง\n` +
      `———————————\n` +
      `รวม: ${cfg.currency}${total.toLocaleString()} (${count} รายการ)`;

    const ok = linePushText_(b.token, b.groupId, text);
    logAlert_('Daily Summary', b.code, '-', '-', count + ' รายการ', text, ok ? 'Sent' : 'Failed');
    if (ok) result.sent++; else result.failed++;
    result.details.push({ code: b.code, name: b.name, status: ok ? 'Sent' : 'Failed', count, total });
  });

  return result;
}

// ========== สมัครสมาชิกใหม่ — ฟอร์ม + บันทึก + สร้างเอกสารปริ้น ==========

// แพ็กเกจสมาชิก: แก้ราคา/ระยะเวลาได้ที่นี่
const MEMBERSHIP_PACKAGES = [
  { code: 'DAY',  label: 'รายวัน',       days: 1,   price: 100,   trainerHrs: 0  },
  { code: 'M1',   label: 'รายเดือน',     days: 30,  price: 1200,  trainerHrs: 0  },
  { code: 'M3',   label: '3 เดือน',      days: 90,  price: 3300,  trainerHrs: 0  },
  { code: 'M6',   label: '6 เดือน',      days: 180, price: 6000,  trainerHrs: 0  },
  { code: 'M12',  label: '1 ปี',         days: 365, price: 10000, trainerHrs: 0  },
];

// แพ็กเกจ PT (ซื้อเสริม): เพิ่มชม.เทรน ไม่ขยายวันสมาชิก
const PT_PACKAGES = [
  { code: 'PT10', label: 'PT 10 ครั้ง',  hours: 10, price: 5000  },
  { code: 'PT20', label: 'PT 20 ครั้ง',  hours: 20, price: 9500  },
  { code: 'PT30', label: 'PT 30 ครั้ง',  hours: 30, price: 13500 },
];

const EXTRA_MEMBER_COLS = [
  'เพศ', 'เลขบัตรประชาชน', 'เบอร์โทร', 'อีเมล', 'ที่อยู่',
  'ฉุกเฉิน-ชื่อ', 'ฉุกเฉิน-เบอร์', 'แพ็กเกจ', 'ราคารวม',
  'โรคประจำตัว/สุขภาพ', 'หมายเหตุ'
];

// เรียกครั้งเดียวจากเมนู: เพิ่มคอลัมน์ที่จำเป็นใน Members ถ้ายังไม่มี
function setupMemberRegistration() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ms = ss.getSheetByName('Members');
  if (!ms) { ui.alert('ไม่พบชีต Members'); return; }

  // หัวคอลัมน์อยู่แถวที่ 2 (ตามโครงสร้างเดิม)
  const headerRow = 2;
  const lastCol = ms.getLastColumn();
  const headers = ms.getRange(headerRow, 1, 1, Math.max(lastCol, 13)).getValues()[0];
  const existing = headers.map(h => String(h || '').trim());

  let nextCol = lastCol + 1;
  let added = 0;
  EXTRA_MEMBER_COLS.forEach(name => {
    if (existing.indexOf(name) === -1) {
      ms.getRange(headerRow, nextCol).setValue(name).setFontWeight('bold');
      nextCol++;
      added++;
    }
  });

  ui.alert(added === 0
    ? 'คอลัมน์ครบแล้ว ไม่ต้องเพิ่ม ✓'
    : `เพิ่มคอลัมน์ใหม่ ${added} คอลัมน์ใน Members เรียบร้อย ✓`);
}

// เปิดฟอร์มสมัครสมาชิก
function menuOpenMemberRegistration() {
  const tpl = HtmlService.createTemplateFromFile('MembershipForm');
  const html = tpl.evaluate().setWidth(720).setHeight(720).setTitle('สมัครสมาชิกใหม่');
  SpreadsheetApp.getUi().showModalDialog(html, 'สมัครสมาชิกใหม่');
}

// ให้ฟอร์มเรียกใช้: ดึงรายการสาขา + แพ็กเกจ
function getRegistrationFormData() {
  const cfg = getConfig_();
  const branches = Object.values(cfg.branches).map(b => ({ code: b.code, name: b.name }));
  return {
    branches,
    packages: MEMBERSHIP_PACKAGES,
    ptPackages: PT_PACKAGES,
    currency: cfg.currency,
    today: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'),
  };
}

// ฟอร์มกด "บันทึก" → server-side handler
function submitMemberRegistration(data) {
  // data = {firstName, lastName, age, gender, idCard, phone, email, lineId,
  //         address, emergencyName, emergencyPhone, branch, packageCode,
  //         ptCode, startDate, health, note}
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ms = ss.getSheetByName('Members');
  if (!ms) throw new Error('ไม่พบชีต Members');

  // หาแพ็กเกจ
  const pkg = MEMBERSHIP_PACKAGES.find(p => p.code === data.packageCode);
  if (!pkg) throw new Error('ไม่พบแพ็กเกจสมาชิก');
  const pt = data.ptCode ? PT_PACKAGES.find(p => p.code === data.ptCode) : null;

  // คำนวณวันหมดอายุ + ราคารวม
  const startDate = data.startDate ? new Date(data.startDate) : new Date();
  startDate.setHours(0,0,0,0);
  const expiry = new Date(startDate.getTime() + pkg.days * 24 * 3600 * 1000);
  const totalPrice = pkg.price + (pt ? pt.price : 0);
  const trainerHrs = (pkg.trainerHrs || 0) + (pt ? pt.hours : 0);

  // gen MemberID ถัดไป (M0001, M0002, ...)
  const memberId = generateNextMemberId_(ms);

  // หา map คอลัมน์จากแถวหัว (row 2)
  const headerRow = 2;
  const headers = ms.getRange(headerRow, 1, 1, ms.getLastColumn()).getValues()[0]
    .map(h => String(h || '').trim());
  const colOf = (label) => headers.indexOf(label) + 1; // 1-based, 0 = not found

  // เขียนแถวใหม่: ใช้ appendRow ด้วย array ตามลำดับคอลัมน์
  const lastRow = ms.getLastRow();
  const newRow = lastRow + 1;

  const fullName = (data.firstName || '') + ' ' + (data.lastName || '');
  const pkgLabel = pkg.label + (pt ? ' + ' + pt.label : '');

  // โครงสร้างหลัก (B..M ตามที่ Code.gs เดิมใช้)
  ms.getRange(newRow, 2).setValue(memberId);                              // B MemberID
  ms.getRange(newRow, 3).setValue(data.firstName || '');                  // C ชื่อ
  ms.getRange(newRow, 4).setValue(data.lastName || '');                   // D นามสกุล
  ms.getRange(newRow, 5).setValue(Number(data.age) || '');                // E อายุ
  ms.getRange(newRow, 6).setValue(data.branch || '');                     // F สาขา
  ms.getRange(newRow, 7).setValue(startDate);                             // G วันสมัคร
  ms.getRange(newRow, 8).setValue(expiry);                                // H วันหมดอายุ
  // I วันคงเหลือ = สูตรเดิม (ถ้ามี) ปล่อยว่างไว้ให้สูตรคำนวณเอง
  ms.getRange(newRow, 10).setValue(trainerHrs);                           // J ชม.เทรน
  ms.getRange(newRow, 12).setValue(data.lineId || '');                    // L LINE UID
  ms.getRange(newRow, 13).setValue('Active');                             // M สถานะ

  ms.getRange(newRow, 7).setNumberFormat('dd mmm yyyy');
  ms.getRange(newRow, 8).setNumberFormat('dd mmm yyyy');

  // คอลัมน์เสริม (เขียนตามชื่อหัวคอลัมน์ ไม่ผูกตำแหน่งตายตัว)
  const extras = {
    'เพศ': data.gender || '',
    'เลขบัตรประชาชน': data.idCard || '',
    'เบอร์โทร': data.phone || '',
    'อีเมล': data.email || '',
    'ที่อยู่': data.address || '',
    'ฉุกเฉิน-ชื่อ': data.emergencyName || '',
    'ฉุกเฉิน-เบอร์': data.emergencyPhone || '',
    'แพ็กเกจ': pkgLabel,
    'ราคารวม': totalPrice,
    'โรคประจำตัว/สุขภาพ': data.health || '',
    'หมายเหตุ': data.note || '',
  };
  Object.keys(extras).forEach(label => {
    const c = colOf(label);
    if (c > 0) ms.getRange(newRow, c).setValue(extras[label]);
  });

  // สร้างเอกสารสัญญา (Google Doc) → คืน URL ให้เปิดปริ้น
  const docUrl = generateMembershipContract_({
    memberId, fullName, age: data.age, gender: data.gender,
    idCard: data.idCard, phone: data.phone, email: data.email,
    address: data.address, emergencyName: data.emergencyName,
    emergencyPhone: data.emergencyPhone, branch: data.branch,
    packageLabel: pkgLabel, totalPrice, trainerHrs,
    startDate, expiry, health: data.health, note: data.note,
  });

  return { ok: true, memberId, docUrl, expiry: Utilities.formatDate(expiry, TZ, 'dd MMM yyyy'), totalPrice };
}

// gen MemberID ถัดไป: ดูแถวที่ใหญ่ที่สุดในคอลัมน์ B แล้ว +1
function generateNextMemberId_(ms) {
  const lastRow = ms.getLastRow();
  if (lastRow < 3) return 'M0001';
  const ids = ms.getRange(3, 2, lastRow - 2, 1).getValues().flat()
    .map(v => String(v || '').trim())
    .filter(v => /^M\d+$/.test(v));
  if (ids.length === 0) return 'M0001';
  const max = Math.max.apply(null, ids.map(v => Number(v.slice(1))));
  return 'M' + String(max + 1).padStart(4, '0');
}

// สร้าง Google Doc สัญญาสมาชิก — return URL ของไฟล์
function generateMembershipContract_(m) {
  const cfg = getConfig_();
  const branchName = (cfg.branches[m.branch] && cfg.branches[m.branch].name) || m.branch || '-';

  const title = `สัญญาสมาชิก ${m.memberId} ${m.fullName} (${Utilities.formatDate(m.startDate, TZ, 'yyyy-MM-dd')})`;
  const doc = DocumentApp.create(title);
  const body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(54).setMarginRight(54);

  // หัวเอกสาร
  const head = body.appendParagraph('FITSTATION 24');
  head.setHeading(DocumentApp.ParagraphHeading.HEADING1)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  const subhead = body.appendParagraph('สัญญาการเป็นสมาชิก / Membership Agreement');
  subhead.setHeading(DocumentApp.ParagraphHeading.HEADING3)
         .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  body.appendParagraph(''); // เว้นบรรทัด

  const meta = body.appendParagraph(
    `เลขที่สมาชิก: ${m.memberId}    สาขา: ${branchName}    ` +
    `วันที่ทำสัญญา: ${Utilities.formatDate(m.startDate, TZ, 'dd MMM yyyy')}`
  );
  meta.setBold(true);

  body.appendHorizontalRule();

  // ข้อมูลสมาชิก (ตาราง 2 คอลัมน์)
  body.appendParagraph('ข้อมูลสมาชิก').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  const infoRows = [
    ['ชื่อ-นามสกุล', m.fullName || '-'],
    ['อายุ', m.age ? (m.age + ' ปี') : '-'],
    ['เพศ', m.gender || '-'],
    ['เลขบัตรประชาชน', m.idCard || '-'],
    ['เบอร์โทร', m.phone || '-'],
    ['อีเมล', m.email || '-'],
    ['ที่อยู่', m.address || '-'],
    ['ผู้ติดต่อฉุกเฉิน', (m.emergencyName || '-') + (m.emergencyPhone ? '  โทร ' + m.emergencyPhone : '')],
    ['โรคประจำตัว / ข้อจำกัดสุขภาพ', m.health || '-'],
  ];
  const infoTable = body.appendTable(infoRows);
  for (let i = 0; i < infoTable.getNumRows(); i++) {
    infoTable.getRow(i).getCell(0).editAsText().setBold(true);
    infoTable.getRow(i).getCell(0).setWidth(170);
  }

  body.appendParagraph('');

  // รายละเอียดแพ็กเกจ
  body.appendParagraph('รายละเอียดแพ็กเกจ').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  const pkgRows = [
    ['แพ็กเกจ', m.packageLabel || '-'],
    ['วันเริ่ม', Utilities.formatDate(m.startDate, TZ, 'dd MMM yyyy')],
    ['วันหมดอายุ', Utilities.formatDate(m.expiry, TZ, 'dd MMM yyyy')],
    ['ชั่วโมงเทรนเนอร์', String(m.trainerHrs || 0) + ' ครั้ง'],
    ['ราคารวม', (cfg.currency || '฿') + Number(m.totalPrice || 0).toLocaleString() + ' บาท'],
  ];
  const pkgTable = body.appendTable(pkgRows);
  for (let i = 0; i < pkgTable.getNumRows(); i++) {
    pkgTable.getRow(i).getCell(0).editAsText().setBold(true);
    pkgTable.getRow(i).getCell(0).setWidth(170);
  }

  body.appendParagraph('');

  // ข้อตกลง
  body.appendParagraph('ข้อตกลงและเงื่อนไข').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  const terms = [
    '1. สมาชิกตกลงชำระค่าบริการเต็มจำนวนตามแพ็กเกจที่ระบุข้างต้น โดยค่าบริการที่ชำระแล้วถือเป็นที่สิ้นสุด ไม่สามารถขอคืนได้ทุกกรณี',
    '2. สมาชิกต้องแสดงบัตรสมาชิกหรือยืนยันตัวตนทุกครั้งที่เข้าใช้บริการ และไม่สามารถโอนสิทธิ์ให้ผู้อื่นใช้แทนได้',
    '3. สมาชิกรับทราบและยอมรับว่าการออกกำลังกายมีความเสี่ยงในตัวเอง สมาชิกได้แจ้งข้อจำกัดด้านสุขภาพตามจริงข้างต้น และจะรับผิดชอบต่อสุขภาพและความปลอดภัยของตนเอง',
    '4. ทางฟิตเนสจะไม่รับผิดชอบต่อทรัพย์สินสูญหายภายในสถานที่ สมาชิกควรดูแลทรัพย์สินส่วนตัวของตนเอง',
    '5. สมาชิกต้องปฏิบัติตามกฎระเบียบของสถานที่ การแต่งกาย และการใช้อุปกรณ์อย่างเคร่งครัด หากฝ่าฝืน ทางฟิตเนสขอสงวนสิทธิ์ในการยกเลิกสมาชิกโดยไม่คืนเงิน',
    '6. ชั่วโมงเทรนเนอร์ส่วนตัว (PT) มีอายุการใช้งานเท่ากับวันหมดอายุของแพ็กเกจสมาชิก ครั้งที่ใช้ไม่หมดถือว่าสิ้นสุดสิทธิ์',
    '7. สมาชิกยินยอมให้ทางฟิตเนสจัดเก็บและใช้ข้อมูลส่วนบุคคลเพื่อการให้บริการ การติดต่อสื่อสาร และการแจ้งเตือนเท่านั้น ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล (PDPA)',
    '8. ทางฟิตเนสขอสงวนสิทธิ์ในการเปลี่ยนแปลงเงื่อนไขการให้บริการ เวลาทำการ และอัตราค่าบริการ โดยจะแจ้งให้สมาชิกทราบล่วงหน้า',
  ];
  terms.forEach(t => {
    const p = body.appendParagraph(t);
    p.setSpacingAfter(4);
  });

  body.appendParagraph('');
  body.appendParagraph(
    'ข้าพเจ้าได้อ่านและทำความเข้าใจข้อตกลงข้างต้นโดยตลอดแล้ว และยินยอมผูกพันตามเงื่อนไขทุกประการ'
  ).setItalic(true);

  body.appendParagraph('');
  body.appendParagraph('');

  // ช่องเซ็น (ตาราง 2 คอลัมน์)
  const signTable = body.appendTable([
    ['ลงชื่อ ........................................... สมาชิก', 'ลงชื่อ ........................................... ผู้ให้บริการ'],
    ['(' + (m.fullName || '                                  ') + ')', '(                                                  )'],
    ['วันที่ ......./......./.......', 'วันที่ ......./......./.......'],
  ]);
  signTable.setBorderWidth(0);
  for (let i = 0; i < signTable.getNumRows(); i++) {
    signTable.getRow(i).getCell(0).setPaddingTop(8);
    signTable.getRow(i).getCell(1).setPaddingTop(8);
  }

  doc.saveAndClose();
  return doc.getUrl();
}

// ใช้ใน HTML template: include() เพื่อแยก CSS/JS เป็นไฟล์ก็ได้ (ตอนนี้รวมอยู่ใน MembershipForm)
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
