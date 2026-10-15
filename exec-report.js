/*
 * FITSTATION 24 — รายงานผู้บริหารทาง LINE (รายวัน / รายสัปดาห์ / รายเดือน)
 * ใช้ร่วมกัน 2 ที่: หน้าเว็บ (index.html → ดูตัวอย่าง/ส่งทดสอบ) และสคริปต์ตั้งเวลา (scripts/send-exec-report.js)
 * วันที่ทั้งหมดคิดตามเวลาเครื่อง — สคริปต์ตั้ง TZ=Asia/Bangkok ไว้แล้ว
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExecReport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const KINDS = {
    daily:   { title: 'สรุปรายวัน',     prevLabel: 'วันก่อนหน้า' },
    weekly:  { title: 'สรุปรายสัปดาห์', prevLabel: 'สัปดาห์ก่อน' },
    monthly: { title: 'สรุปรายเดือน',   prevLabel: 'เดือนก่อน' },
  };
  // ลำดับตามที่ผู้บริหารต้องการ: Walk-in, BR, Renew, Online
  const CHANNELS = [['Walk-In', 'Walk-in'], ['Br', 'BR'], ['Renew', 'Renew'], ['Online', 'Online']];
  const SALE_TYPES = ['MEM', 'PT', 'MEM+PT', 'Plan'];

  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  // ช่วงเวลาของรายงานที่ "จบ" ในวัน ref (end ไม่รวม): วันนั้น / สัปดาห์จันทร์–อาทิตย์ / ทั้งเดือน
  function periodFor(kind, ref) {
    const d0 = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    if (kind === 'daily') {
      return { start: d0, end: addDays(d0, 1), prevStart: addDays(d0, -1), prevEnd: d0 };
    }
    if (kind === 'weekly') {
      const start = addDays(d0, -((d0.getDay() + 6) % 7));
      return { start, end: addDays(start, 7), prevStart: addDays(start, -7), prevEnd: start };
    }
    const start = new Date(d0.getFullYear(), d0.getMonth(), 1);
    return {
      start, end: new Date(d0.getFullYear(), d0.getMonth() + 1, 1),
      prevStart: new Date(d0.getFullYear(), d0.getMonth() - 1, 1), prevEnd: start,
    };
  }

  // รายงานไหนถึงกำหนดส่งในวัน ref: รายวันทุกวัน, รายสัปดาห์วันอาทิตย์, รายเดือนวันสุดท้ายของเดือน
  function dueKinds(ref) {
    const kinds = ['daily'];
    if (ref.getDay() === 0) kinds.push('weekly');
    if (addDays(ref, 1).getDate() === 1) kinds.push('monthly');
    return kinds;
  }

  const memPart = (s) => s.type === 'MEM' ? Number(s.amount) || 0
    : s.type === 'MEM+PT' ? (s.memAmount != null ? Number(s.memAmount) : (Number(s.amount) || 0) / 2) : 0;
  const ptPart = (s) => s.type === 'PT' ? Number(s.amount) || 0
    : s.type === 'MEM+PT' ? (s.ptAmount != null ? Number(s.ptAmount) : (Number(s.amount) || 0) / 2) : 0;

  function summarize(sales, start, end) {
    const list = sales.filter(s => {
      if (!SALE_TYPES.includes(s.type) || !s.ts) return false;
      const t = new Date(s.ts);
      return t >= start && t < end;
    });
    const sum = (arr, f) => arr.reduce((a, s) => a + f(s), 0);
    const out = {
      total: sum(list, s => Number(s.amount) || 0),
      count: list.length,
      mem: sum(list, memPart), memCount: list.filter(s => s.type === 'MEM' || s.type === 'MEM+PT').length,
      pt: sum(list, ptPart), ptCount: list.filter(s => s.type === 'PT' || s.type === 'MEM+PT').length,
      plan: sum(list.filter(s => s.type === 'Plan'), s => Number(s.amount) || 0),
      planCount: list.filter(s => s.type === 'Plan').length,
      channels: CHANNELS.map(([key, label]) => {
        const items = list.filter(s => s.channel === key);
        return { label, count: items.length, amount: sum(items, s => Number(s.amount) || 0) };
      }),
      branches: {},
    };
    const known = CHANNELS.map(c => c[0]);
    const other = list.filter(s => !known.includes(s.channel));
    if (other.length) out.channels.push({ label: 'อื่น ๆ', count: other.length, amount: sum(other, s => Number(s.amount) || 0) });
    list.forEach(s => {
      const b = out.branches[s.branch] = out.branches[s.branch] || { total: 0, mem: 0, pt: 0 };
      b.total += Number(s.amount) || 0; b.mem += memPart(s); b.pt += ptPart(s);
    });
    return out;
  }

  function dateLabel(kind, p) {
    const th = (d, o) => d.toLocaleDateString('th-TH', o);
    if (kind === 'daily') return th(p.start, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    if (kind === 'monthly') return th(p.start, { month: 'long', year: 'numeric' });
    const last = addDays(p.end, -1);
    return `${th(p.start, { day: 'numeric', month: 'short' })} – ${th(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  /**
   * สร้างข้อความรายงาน
   * @param {object} o { kind, ref (Date), sales, branches, currency, brand, partial (true = ช่วงยังไม่จบ เช่นดูตัวอย่าง) }
   */
  function build(o) {
    const kind = KINDS[o.kind] ? o.kind : 'daily';
    const cur = o.currency || '฿';
    const money = (n) => cur + Math.round(n).toLocaleString('en-US');
    const p = periodFor(kind, o.ref || new Date());
    const now = summarize(o.sales || [], p.start, p.end);
    const prev = summarize(o.sales || [], p.prevStart, p.prevEnd);

    let cmp;
    if (prev.total > 0) {
      const pct = Math.round((now.total - prev.total) / prev.total * 100);
      cmp = `   ${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% จาก${KINDS[kind].prevLabel} (${money(prev.total)})`;
    } else {
      cmp = `   ${KINDS[kind].prevLabel}: ${money(0)}`;
    }

    const lines = [
      `📊 รายงานผู้บริหาร · ${KINDS[kind].title}`,
      `🏢 ${o.brand || 'FITSTATION 24'}`,
      `📅 ${dateLabel(kind, p)}${o.partial ? ' (ถึงตอนนี้)' : ''}`,
      '━━━━━━━━━━━━━━',
      `💰 ยอดขายรวม ${money(now.total)}`,
      cmp,
      '',
      `ยอดขาย MB ${money(now.mem)} (${now.memCount} รายการ)`,
      `ยอดขาย PT ${money(now.pt)} (${now.ptCount} รายการ)`,
    ];
    if (now.planCount > 0) lines.push(`ยอดขาย Plan ${money(now.plan)} (${now.planCount} รายการ)`);

    lines.push('', '👥 ช่องทางลูกค้า');
    now.channels.forEach(c => lines.push(`• ${c.label} ${c.count} ราย · ${money(c.amount)}`));

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
      const days = Math.max(1, Math.round((p.end - p.start) / 86400000));
      lines.push('', `📈 เฉลี่ยต่อวัน ${money(now.total / days)}`);
    }
    lines.push('━━━━━━━━━━━━━━');
    return lines.join('\n');
  }

  return { KINDS, periodFor, dueKinds, summarize, build, isoDay, addDays };
});
