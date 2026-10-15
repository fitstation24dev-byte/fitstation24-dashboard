/*
 * FITSTATION 24 — รายงานสรุปยอดทาง LINE
 *   รายงานผู้บริหาร (กลุ่มผู้บริหาร): รายวัน / รายสัปดาห์ / รายเดือน   → build()
 *   กลุ่มสาขา: สรุปรายวัน (ยอดรายคน + เทรนของเมื่อวาน)               → buildBranchDaily()
 *              สรุปรายเดือน (ยอด + ช่องทาง + จำนวนเทรน)              → buildBranchMonthly()
 * ใช้ร่วมกัน 2 ที่: หน้าเว็บ (index.html → ดูตัวอย่าง/ส่งทดสอบ) และสคริปต์ตั้งเวลา (scripts/send-exec-report.js)
 * วันที่ทั้งหมดคิดตามเวลาเครื่อง — สคริปต์ตั้ง TZ=Asia/Bangkok ไว้แล้ว
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExecReport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const KINDS = {
    daily:   { title: 'สรุปรายวัน',     prevLabel: 'วันก่อนหน้า' },
    weekly:  { title: 'สรุปรายสัปดาห์', prevLabel: 'สัปดาห์ก่อน' },   // สัปดาห์ = ช่วงวันที่ 1–7 / 8–14 / 15–21 / 22–สิ้นเดือน
    monthly: { title: 'สรุปรายเดือน',   prevLabel: 'เดือนก่อน' },
  };
  // ลำดับตามที่ผู้บริหารต้องการ: Walk-in, BR, Renew, Online
  const CHANNELS = [['Walk-In', 'Walk-in'], ['Br', 'BR'], ['Renew', 'Renew'], ['Online', 'Online']];
  const SALE_TYPES = ['MEM', 'PT', 'MEM+PT', 'Plan'];
  const LINE = '━━━━━━━━━━━━━━';

  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const moneyFn = (cur) => (n) => (cur || '฿') + Math.round(n).toLocaleString('en-US');
  const inRange = (ts, start, end) => { if (!ts) return false; const t = new Date(ts); return t >= start && t < end; };

  // สัปดาห์ของเดือน: เริ่มวันที่ 1 / 8 / 15 / 22 · ช่วงสุดท้าย (22–สิ้นเดือน) รวมวันที่เหลือทั้งหมด
  function weekBlock(d) {
    const y = d.getFullYear(), m = d.getMonth();
    const startDay = Math.min(22, Math.floor((d.getDate() - 1) / 7) * 7 + 1);
    const start = new Date(y, m, startDay);
    const end = startDay === 22 ? new Date(y, m + 1, 1) : new Date(y, m, startDay + 7);
    return { start, end };
  }

  // ช่วงเวลาของรายงานที่ครอบวัน ref (end ไม่รวม): วันนั้น / สัปดาห์ของเดือน (1–7, 8–14, 15–21, 22–สิ้นเดือน) / ทั้งเดือน
  function periodFor(kind, ref) {
    const d0 = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    if (kind === 'daily') {
      return { start: d0, end: addDays(d0, 1), prevStart: addDays(d0, -1), prevEnd: d0 };
    }
    if (kind === 'weekly') {
      const cur = weekBlock(d0);
      const prev = weekBlock(addDays(cur.start, -1));
      return { start: cur.start, end: cur.end, prevStart: prev.start, prevEnd: prev.end };
    }
    const start = new Date(d0.getFullYear(), d0.getMonth(), 1);
    return {
      start, end: new Date(d0.getFullYear(), d0.getMonth() + 1, 1),
      prevStart: new Date(d0.getFullYear(), d0.getMonth() - 1, 1), prevEnd: start,
    };
  }

  // รายงานผู้บริหารที่ถึงกำหนดในวัน ref: รายวันทุกวัน, รายสัปดาห์วันสุดท้ายของแต่ละช่วง (7 / 14 / 21 / สิ้นเดือน),
  // รายเดือนวันสุดท้ายของเดือน
  function dueKinds(ref) {
    const kinds = ['daily'];
    if (addDays(weekBlock(ref).end, -1).getDate() === ref.getDate()) kinds.push('weekly');
    if (isLastDayOfMonth(ref)) kinds.push('monthly');
    return kinds;
  }
  const isLastDayOfMonth = (ref) => addDays(ref, 1).getDate() === 1;

  // แยกยอดของรายการขาย 1 รายการให้พนักงานแต่ละคน เป็นส่วน MEM / PT / Plan / อื่น ๆ
  // MEM+PT: split ที่พนักงานเลือกประเภทไว้ใช้ตรง ๆ; ไม่งั้นใช้ memAmount/ptAmount (ไม่มี = ครึ่ง ๆ) กระจายตามสัดส่วนยอด
  function saleEmpShares(s) {
    const total = Number(s.amount) || 0;
    let mem = 0, pt = 0, plan = 0, other = 0;
    if (s.type === 'MEM') mem = total;
    else if (s.type === 'PT') pt = total;
    else if (s.type === 'MEM+PT') {
      mem = s.memAmount != null ? Number(s.memAmount) : total / 2;
      pt  = s.ptAmount  != null ? Number(s.ptAmount)  : total / 2;
    }
    else if (s.type === 'Plan') plan = total;
    else other = total;
    const ratio = total > 0 ? 1 / total : 0;
    const contributions = (Array.isArray(s.splits) && s.splits.length > 0)
      ? s.splits.map(sp => ({ empId: sp.empId, amount: Number(sp.amount) || 0, splitType: sp.type }))
      : (s.empId ? [{ empId: s.empId, amount: total }] : []);
    return contributions.filter(c => c.empId).map(c => {
      if (s.type === 'MEM+PT' && (c.splitType === 'MEM' || c.splitType === 'PT')) {
        return { empId: c.empId, mem: c.splitType === 'MEM' ? c.amount : 0, pt: c.splitType === 'PT' ? c.amount : 0, plan: 0, other: 0 };
      }
      const w = c.amount * ratio;
      return { empId: c.empId, mem: mem * w, pt: pt * w, plan: plan * w, other: other * w };
    });
  }

  // ยอด MB / PT ของรายการขาย = ผลรวมส่วนของพนักงาน (ตรงกับยอดรายคน); ไม่มีผู้ขาย → คิดจากทั้งบิล
  function saleParts(s) {
    const shares = saleEmpShares(s);
    if (shares.length) return shares.reduce((a, c) => ({ mem: a.mem + c.mem, pt: a.pt + c.pt }), { mem: 0, pt: 0 });
    return saleEmpShares({ ...s, splits: [], empId: '_' })[0];
  }

  function summarize(sales, start, end, trainings) {
    const list = (sales || []).filter(s => SALE_TYPES.includes(s.type) && inRange(s.ts, start, end));
    const sum = (arr, f) => arr.reduce((a, s) => a + f(s), 0);
    const parts = list.map(s => ({ s, ...saleParts(s) }));
    const out = {
      total: sum(list, s => Number(s.amount) || 0),
      count: list.length,
      mem: sum(parts, p => p.mem), memCount: parts.filter(p => p.mem > 0).length,
      pt: sum(parts, p => p.pt), ptCount: parts.filter(p => p.pt > 0).length,
      plan: sum(list.filter(s => s.type === 'Plan'), s => Number(s.amount) || 0),
      planCount: list.filter(s => s.type === 'Plan').length,
      trainCount: (trainings || []).filter(t => t.verified !== false && inRange(t.ts, start, end)).length,
      channels: CHANNELS.map(([key, label]) => {
        const items = list.filter(s => s.channel === key);
        return { label, count: items.length, amount: sum(items, s => Number(s.amount) || 0) };
      }),
      branches: {},
    };
    const known = CHANNELS.map(c => c[0]);
    const other = list.filter(s => !known.includes(s.channel));
    if (other.length) out.channels.push({ label: 'อื่น ๆ', count: other.length, amount: sum(other, s => Number(s.amount) || 0) });
    parts.forEach(({ s, mem, pt }) => {
      const b = out.branches[s.branch] = out.branches[s.branch] || { total: 0, mem: 0, pt: 0 };
      b.total += Number(s.amount) || 0; b.mem += mem; b.pt += pt;
    });
    return out;
  }

  function compareLine(now, prev, prevLabel, money) {
    if (prev.total > 0) {
      const pct = Math.round((now.total - prev.total) / prev.total * 100);
      return `   ${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% จาก${prevLabel} (${money(prev.total)})`;
    }
    return `   ${prevLabel}: ${money(0)}`;
  }
  function moneyLines(now, money, withCounts) {
    const c = (n) => withCounts ? ` (${n} รายการ)` : '';
    const lines = [`ยอดขาย MB ${money(now.mem)}${c(now.memCount)}`, `ยอดขาย PT ${money(now.pt)}${c(now.ptCount)}`];
    if (now.planCount > 0) lines.push(`ยอดขาย Plan ${money(now.plan)}${c(now.planCount)}`);
    return lines;
  }
  const channelLines = (now, money) => now.channels.map(c => `• ${c.label} ${c.count} ราย · ${money(c.amount)}`);

  function dateLabel(kind, p) {
    const th = (d, o) => d.toLocaleDateString('th-TH', o);
    if (kind === 'daily') return th(p.start, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    if (kind === 'monthly') return th(p.start, { month: 'long', year: 'numeric' });
    const last = addDays(p.end, -1);
    return `${th(p.start, { day: 'numeric', month: 'short' })} – ${th(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  /**
   * รายงานผู้บริหาร (รวมทุกสาขา)
   * @param {object} o { kind, ref (Date), sales, branches, currency, brand, partial (true = ช่วงยังไม่จบ เช่นดูตัวอย่าง) }
   */
  function build(o) {
    const kind = KINDS[o.kind] ? o.kind : 'daily';
    const money = moneyFn(o.currency);
    const p = periodFor(kind, o.ref || new Date());
    const now = summarize(o.sales, p.start, p.end);
    const prev = summarize(o.sales, p.prevStart, p.prevEnd);

    const lines = [
      `📊 รายงานผู้บริหาร · ${KINDS[kind].title}`,
      `🏢 ${o.brand || 'FITSTATION 24'}`,
      `📅 ${dateLabel(kind, p)}${o.partial ? ' (ถึงตอนนี้)' : ''}`,
      LINE,
      `💰 ยอดขายรวม ${money(now.total)}`,
      compareLine(now, prev, KINDS[kind].prevLabel, money),
      '',
      ...moneyLines(now, money, true),
      '', '👥 ช่องทางลูกค้า',
      ...channelLines(now, money),
    ];

    const brCodes = Object.keys(now.branches);
    if (brCodes.length > 1) {
      lines.push('', '🏬 แยกตามสาขา');
      (o.branches || []).forEach(b => {
        const x = now.branches[b.code];
        if (!x) return;
        lines.push(`• ${b.code} ${money(x.total)} (MB ${money(x.mem)} / PT ${money(x.pt)})`);
      });
    }

    if (kind !== 'daily') {
      // ช่วงยังไม่จบ (ดูตัวอย่าง/ส่งทดสอบ) → เฉลี่ยเฉพาะวันที่ผ่านมาแล้ว
      const ref = o.ref || new Date();
      const until = o.partial ? Math.min(p.end, addDays(ref, 1)) : p.end;
      const days = Math.max(1, Math.round((until - p.start) / 86400000));
      lines.push('', `📈 เฉลี่ยต่อวัน ${money(now.total / days)}`);
    }
    lines.push(LINE);
    return lines.join('\n');
  }

  /**
   * รายงานผู้บริหารตามช่วงวันที่ที่เลือกเอง (เช่น ส่งย้อนหลัง 1–30 ก.ย.) — เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน
   * @param {object} o { from (Date), to (Date, รวมวันนี้), sales, branches, currency, brand }
   */
  function buildRange(o) {
    const money = moneyFn(o.currency);
    const start = new Date(o.from.getFullYear(), o.from.getMonth(), o.from.getDate());
    const end = addDays(new Date(o.to.getFullYear(), o.to.getMonth(), o.to.getDate()), 1);
    const days = Math.max(1, Math.round((end - start) / 86400000));
    const wholeMonth = start.getDate() === 1 && end.getDate() === 1 && days >= 28 && days <= 31;
    // เทียบกับ: ทั้งเดือน → เดือนก่อนทั้งเดือน, อื่น ๆ → ช่วงก่อนหน้าที่ยาวเท่ากัน
    const prevStart = wholeMonth ? new Date(start.getFullYear(), start.getMonth() - 1, 1) : addDays(start, -days);
    const prevLabel = days === 1 ? 'วันก่อนหน้า' : wholeMonth ? 'เดือนก่อน' : ` ${days} วันก่อนหน้า`;
    const now = summarize(o.sales, start, end);
    const prev = summarize(o.sales, prevStart, start);
    const today = new Date(); const partial = end > today;
    const elapsed = partial ? Math.max(1, Math.round((addDays(today, 1) - start) / 86400000)) : days;

    const th = (d, opt) => d.toLocaleDateString('th-TH', opt);
    const last = addDays(end, -1);
    const title = days === 1 ? 'สรุปรายวัน' : wholeMonth ? 'สรุปรายเดือน' : 'สรุปตามช่วงวันที่';
    const label = days === 1 ? th(start, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
      : wholeMonth ? th(start, { month: 'long', year: 'numeric' })
      : `${th(start, { day: 'numeric', month: 'short' })} – ${th(last, { day: 'numeric', month: 'short', year: 'numeric' })} (${days} วัน)`;

    const lines = [
      `📊 รายงานผู้บริหาร · ${title}`,
      `🏢 ${o.brand || 'FITSTATION 24'}`,
      `📅 ${label}${partial ? ' (ถึงตอนนี้)' : ''}`,
      LINE,
      `💰 ยอดขายรวม ${money(now.total)}`,
      compareLine(now, prev, prevLabel, money),
      '',
      ...moneyLines(now, money, true),
      '', '👥 ช่องทางลูกค้า',
      ...channelLines(now, money),
    ];
    const brCodes = Object.keys(now.branches);
    if (brCodes.length > 1) {
      lines.push('', '🏬 แยกตามสาขา');
      (o.branches || []).forEach(b => {
        const x = now.branches[b.code];
        if (x) lines.push(`• ${b.code} ${money(x.total)} (MB ${money(x.mem)} / PT ${money(x.pt)})`);
      });
    }
    if (days > 1) lines.push('', `📈 เฉลี่ยต่อวัน ${money(now.total / elapsed)}`);
    lines.push(LINE);
    return lines.join('\n');
  }

  /**
   * สรุปรายเดือนของสาขา: ยอดรวม + MB / PT + ช่องทางลูกค้า + จำนวนเทรนทั้งหมด (ไม่แยกรายคน) · คืน null ถ้าไม่มีอะไรให้ส่ง
   * @param {object} o { ref (Date ในเดือนนั้น), branch {code,name}, sales, trainings, currency, partial }
   */
  function buildBranchMonthly(o) {
    const money = moneyFn(o.currency);
    const p = periodFor('monthly', o.ref || new Date());
    const code = o.branch.code;
    const sales = (o.sales || []).filter(s => s.branch === code);
    const trainings = (o.trainings || []).filter(t => t.branch === code);
    const now = summarize(sales, p.start, p.end, trainings);
    if (now.count === 0 && now.trainCount === 0) return null;   // สาขาที่ทั้งเดือนไม่มียอดและไม่มีเทรน — ไม่ต้องส่ง
    const prev = summarize(sales, p.prevStart, p.prevEnd);
    return [
      `📊 สรุปยอดประจำเดือน — ${o.branch.name || code}`,
      `📅 ${dateLabel('monthly', p)}${o.partial ? ' (ถึงตอนนี้)' : ''}`,
      LINE,
      `💰 ยอดขายรวม ${money(now.total)}`,
      compareLine(now, prev, 'เดือนก่อน', money),
      '',
      ...moneyLines(now, money, false),
      '', '👥 ช่องทางลูกค้า',
      ...channelLines(now, money),
      '', `🏋️ จำนวนเทรนทั้งหมด ${now.trainCount} ครั้ง`,
      LINE,
    ].join('\n');
  }

  /**
   * สรุปผลรายวันของสาขา (รูปแบบเดิม): ยอดรายคน MEM / PT / เทรน ของวัน day
   * คืน null ถ้าวันนั้นไม่มียอดขายและไม่มีการเทรน (ไม่ต้องส่ง)
   * @param {object} o { day (Date), branch {code,name}, sales, trainings, employees, currency }
   */
  function buildBranchDaily(o) {
    const cur = o.currency || '฿';
    const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
    const p = periodFor('daily', o.day);
    const code = o.branch.code;
    const sales = (o.sales || []).filter(s => s.branch === code && SALE_TYPES.includes(s.type) && inRange(s.ts, p.start, p.end));
    const trains = (o.trainings || []).filter(t => t.branch === code && t.verified !== false && inRange(t.ts, p.start, p.end));

    const per = {};
    const slot = (id) => per[id] = per[id] || { mem: 0, pt: 0, train: 0 };
    sales.forEach(s => saleEmpShares(s).forEach(c => { const e = slot(c.empId); e.mem += c.mem; e.pt += c.pt; }));
    trains.forEach(t => { if (t.trainerId) slot(t.trainerId).train += 1; });
    const ids = Object.keys(per).filter(id => per[id].mem > 0 || per[id].pt > 0 || per[id].train > 0);
    if (ids.length === 0) return null;
    ids.sort((a, b) => (per[b].mem + per[b].pt) - (per[a].mem + per[a].pt) || per[b].train - per[a].train);

    const name = (id) => {
      const e = (o.employees || []).find(x => x.id === id);
      return e ? `${e.name || ''} ${e.surname || ''}`.trim() || id : id;
    };
    const parts = sales.map(saleParts);
    const totalMem = parts.reduce((a, x) => a + x.mem, 0);
    const totalPt = parts.reduce((a, x) => a + x.pt, 0);
    const totalAll = sales.reduce((a, s) => a + (Number(s.amount) || 0), 0);
    const dateStr = p.start.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });

    return [
      `📊 สรุปผลรายวัน — ${o.branch.name || code}`,
      `วันที่ ${dateStr}`,
      '',
      ...ids.map((id, i) => `${i + 1}. ${name(id)} — MEM ${fmt(per[id].mem)} / PT ${fmt(per[id].pt)} / เทรน ${per[id].train}`),
      '',
      '──────────',
      `ยอดรวม: ${cur}${fmt(totalAll)}`,
      `MEM: ${cur}${fmt(totalMem)} · PT: ${cur}${fmt(totalPt)}`,
      `เทรนทั้งหมด: ${trains.length} ครั้ง`,
    ].join('\n');
  }

  return {
    KINDS, periodFor, dueKinds, isLastDayOfMonth, summarize, saleEmpShares,
    build, buildRange, buildBranchMonthly, buildBranchDaily, isoDay, addDays,
  };
});
