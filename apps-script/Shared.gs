// Generated from the current scanner rules. Do not hand edit.
const SCALE = 1000000n;
function units(raw) {
    const str = String(raw).trim();
    if (!/^\d{1,18}(?:\.\d{1,6})?$/.test(str))
        throw Error('请输入有效数量，最多 6 位小数');
    const [a, b = ''] = str.split('.');
    return BigInt(a) * SCALE + BigInt(b.padEnd(6, '0'));
}
function format(n) { const neg = n < 0n; if (neg)
    n = -n; const whole = n / SCALE, part = (n % SCALE).toString().padStart(6, '0').replace(/0+$/, ''); return (neg ? '-' : '') + whole + (part ? '.' + part : ''); }
function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (quoted && text[i + 1] === '"') {
                field += '"';
                i++;
            }
            else if (quoted) {
                quoted = false;
            }
            else if (!field) {
                quoted = true;
            }
            else
                throw Error('CSV 引号格式异常');
        }
        else if (c === ',' && !quoted) {
            row.push(field);
            field = '';
        }
        else if ((c === '\n' || c === '\r') && !quoted) {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        }
        else
            field += c;
    }
    if (quoted)
        throw Error('CSV 引号未结束');
    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}
function isReplacementSku(sku) { return typeof sku === 'string' && sku === sku.trim() && sku.length <= 256 && !/[\u0000-\u001f\u007f]/.test(sku) && /replacement/i.test(sku); }
function isInventorySku(sku) { return /^[0-9]{1,18}$/.test(sku) || isReplacementSku(sku); }
function parseReport(text) {
    const rows = parseCSV(text);
    const h = rows.slice(0, 40).findIndex(r => r[1]?.trim().toLowerCase() === 'bin' && r[2]?.trim().toLowerCase() === 'sku');
    if (h < 0 || rows[h][6]?.trim().toLowerCase() !== 'available')
        throw Error('库存列结构已变化，请检查 B 列 Bin、C 列 SKU 和 G 列 Available');
    const data = {}, labels = {}, issues = {}, owners = {};
    let missing = 0, zero = 0;
    const issue = (loc, txt) => { (issues[loc] ?? (issues[loc] = [])).push(txt); };
    for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.every(v => !v.trim()))
            continue;
        if (r.length < 7)
            throw Error(`第 ${i + 1} 行字段不足`);
        const loc = r[1].trim().toUpperCase();
        if (!loc) {
            missing++;
            continue;
        }
        const label = r[2].trim(), match = label.match(/^.+~([0-9]+)$/);
        if (!match && !isReplacementSku(label)) {
            issue(loc, `第 ${i + 1} 行商品没有有效的 ~数字 后缀（${label}）`);
            continue;
        }
        const sku = match ? match[1] : label;
        if (labels[sku] && labels[sku] !== label)
            throw Error(`数字 SKU ${sku} 对应多个完整 SKU，需核实源数据`);
        labels[sku] = label;
        const owner = r[0].trim();
        if (owners[loc] && owners[loc] !== owner)
            issue(loc, '相同库位号属于多个仓库');
        owners[loc] = owner;
        let n;
        try {
            n = units(r[6]);
        }
        catch {
            issue(loc, `SKU ${sku} 的 G 列数量无效或为负数（${r[6]}）`);
            continue;
        }
        if (!n) {
            zero++;
            continue;
        }
        data[loc] ?? (data[loc] = {});
        data[loc][sku] = format(units(data[loc][sku] ?? '0') + n);
    }
    if (!Object.keys(data).length)
        throw Error('没有可核对的正数量库存');
    return { data, labels, issues, quantityBasis: 'G · Available', notes: [`${missing} 行未指定库位`, `${zero} 行零数量`, `${Object.keys(issues).length} 个库位有数据异常`] };
}
function startSession(inv, location) {
    const loc = location.trim().toUpperCase();
    if (!loc)
        throw Error('请先输入库位');
    if (inv.issues[loc])
        throw Error(`${loc} 源数据异常：${inv.issues[loc].join('；')}`);
    if (!inv.data[loc])
        throw Error(`找不到 ${loc} 的正数量库存，请检查库位`);
    return attachStockReference({ location: loc, expected: { ...inv.data[loc] }, labels: { ...inv.labels }, scanned: {}, round: 1, completionCount: 0, recheckRequired: false, phase: 'scanning', startedAt: new Date().toISOString(), snapshot: { fetchedAt: inv.fetchedAt, version: inv.version, quantityBasis: inv.quantityBasis } }, inv);
}
function attachStockReference(s, inv) {
    const bySku = {};
    for (const [loc, items] of Object.entries(inv.data))
        for (const [sku, count] of Object.entries(items)) {
            if (units(count) <= 0n)
                continue;
            bySku[sku] ?? (bySku[sku] = {});
            bySku[sku][loc] = count;
        }
    const issues = Object.fromEntries(Object.entries(inv.issues).map(([loc, errors]) => [loc, [...errors]]));
    return { ...s, reference: { bySku, issues, fetchedAt: inv.fetchedAt, version: inv.version, quantityBasis: inv.quantityBasis } };
}
function otherLocationHint(s, sku) {
    if (!s.reference)
        return '其他库位数据暂不可用，请刷新库存后查看。';
    const items = s.reference.bySku[sku] ?? {};
    const pairs = Object.entries(items).filter(([loc, count]) => loc !== s.location && units(count) > 0n).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    if (!pairs.length)
        return '其他库位未查到该 SKU 的正可用数量（G 列）。';
    return '其他库位（G 列可用数量）：' + pairs.map(([loc, count]) => loc + '：' + count + (s.reference.issues[loc] ? '（源数据异常，仅供参考）' : '')).join('；');
}
function scanCheck(s, raw) { if (s.phase !== 'scanning')
    throw Error('请先点击「继续补扫」'); const sku = raw.trim(); if (!/^[0-9]{4,5}$/.test(sku))
    throw Error('请扫描正确的 SKU 条码：只接受 4 位或 5 位纯数字，工厂长条码不计数'); return sku; }
function recordQuantity(s, raw, quantity) {
    if (s.phase !== 'scanning')
        throw Error('当前核对已完成，请先继续补扫');
    let sku = raw.trim();
    if (!/^[0-9]{4,5}$/.test(sku) && !isReplacementSku(sku))
        throw Error('手动输入只接受 4 / 5 位数字 SKU 或包含 Replacement 的 SKU');
    if (isReplacementSku(sku)) {
        const known = Object.keys(s.labels).filter(k => k.toLowerCase() === sku.toLowerCase());
        if (known.length === 1)
            sku = known[0];
    }
    const amount = units(quantity);
    if (amount === 0n) {
        if (!(sku in s.expected))
            throw Error('零数量仅用于当前库位应有的 SKU；误扫的多出商品请删除记录');
        return { ...s, scanned: { ...s.scanned, [sku]: '0' } };
    }
    const total = format(units(s.scanned[sku] ?? '0') + amount);
    // Keep the accumulated value within the same bounds accepted by restore().
    units(total);
    return { ...s, scanned: { ...s.scanned, [sku]: total } };
}
function recordItem(s, raw) { return recordQuantity(s, scanCheck(s, raw), '1'); }
function availableLocations(inv) { return Object.keys(inv.data).filter(loc => !inv.issues[loc]).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); }
function locationSuggestions(locations, raw, limit = 20) { const prefix = raw.trim().toUpperCase(); return locations.filter(loc => loc.startsWith(prefix)).slice(0, limit); }
function saveCount(s, sku, count, kind, accept) {
    if (s.phase !== 'scanning')
        throw Error('当前核对已完成，请先继续补扫');
    if (!isInventorySku(sku))
        throw Error('条码格式错误');
    if (kind === 'scan' && sku in s.scanned)
        throw Error('重复条码，未增加数量');
    if (kind === 'edit' && !(sku in s.scanned))
        throw Error('该商品尚未记录');
    if (!(sku in s.expected) && !accept)
        throw Error('请勾选确认：该商品实物确实位于当前库位');
    const n = units(count);
    if (n === 0n && !(sku in s.expected))
        throw Error('零数量仅用于当前库位应有的 SKU；误扫的多出商品请删除记录');
    return { ...s, scanned: { ...s.scanned, [sku]: format(n) } };
}
function results(s) { return [...new Set([...Object.keys(s.expected), ...Object.keys(s.scanned)])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(sku => { const e = units(s.expected[sku] ?? '0'), a = units(s.scanned[sku] ?? '0'); return { sku, label: s.labels[sku] ?? '未知 SKU', expected: format(e), actual: sku in s.scanned ? format(a) : '', diff: format(a - e), status: !(sku in s.scanned) ? '漏扫' : !(sku in s.expected) ? '多出' : e === a ? '一致' : '数量不符' }; }); }
// First completion with differences stays editable and cannot create a cloud report.
// A persisted completion count keeps the mandatory second check intact after reload.
function completeRound(s, now = new Date().toISOString()) {
    if (s.phase !== 'scanning')
        throw Error('当前核对已完成，请先继续补扫');
    const completionCount = (s.completionCount ?? 0) + 1;
    const recheckRequired = completionCount === 1 && results(s).some(r => r.status !== '一致');
    return { ...s, completionCount, recheckRequired, phase: recheckRequired ? 'scanning' : 'finished', round: s.round + (recheckRequired ? 1 : 0), checkedAt: recheckRequired ? undefined : now };
}
function normalizeBaselineOverride(raw) {
    const string = (value, max = 256) => { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value))
        throw Error('Cin7 基准记录格式异常'); return value.trim(); };
    if (!raw || raw.source !== 'cin7' || typeof raw.googlePresent !== 'boolean' || typeof raw.zeroConfirmed !== 'boolean')
        throw Error('Cin7 基准记录格式异常');
    const quantity = format(units(string(raw.quantity, 32))), googleQuantity = format(units(string(raw.googleQuantity, 32))), physicalQuantity = format(units(string(raw.physicalQuantity, 32)));
    if (quantity !== physicalQuantity || (quantity === '0' && !raw.zeroConfirmed))
        throw Error('Cin7 基准需与确认的实点数量一致');
    const fetchedAt = string(raw.fetchedAt, 64), adoptedAt = string(raw.adoptedAt, 64);
    if (!Number.isFinite(Date.parse(fetchedAt)) || !Number.isFinite(Date.parse(adoptedAt)))
        throw Error('Cin7 基准时间无效');
    return { source: 'cin7', quantity, googleQuantity, googlePresent: raw.googlePresent, warehouse: string(raw.warehouse), bin: string(raw.bin), fetchedAt: new Date(fetchedAt).toISOString(), adoptedAt: new Date(adoptedAt).toISOString(), physicalQuantity, zeroConfirmed: raw.zeroConfirmed };
}
function cin7BaselineCandidate(s, sku, result, confirmZero = false, now = Date.now()) {
    if (!/^[0-9]{4,5}$/.test(sku) || !result?.ok || result.numericSku !== sku || !Array.isArray(result.groups))
        throw Error('Cin7 查询结果无法用于当前 SKU');
    const full = s.labels[sku] && s.labels[sku].endsWith('~' + sku) ? s.labels[sku] : sku;
    if (result.sku !== full)
        throw Error('Cin7 查询结果无法用于当前 SKU');
    const age = now - Date.parse(result.fetchedAt);
    if (!Number.isFinite(age) || age > 300000 || age < -60000)
        throw Error('Cin7 查询已超过 5 分钟，请重新查询后采用');
    const matches = result.groups.filter((r) => (String(r.bin || r.location || '')).trim().toUpperCase() === s.location.toUpperCase());
    if (matches.length !== 1 || !matches[0].location)
        throw Error('Cin7 当前库位不唯一或没有返回，不能采用基准');
    const row = matches[0];
    if (row.available === null || row.available === undefined)
        throw Error('Cin7 当前库位可用数量缺失，不能采用基准');
    let quantity;
    try {
        quantity = format(units(String(row.available)));
    }
    catch {
        throw Error('Cin7 可用数量必须为非负有效数量');
    }
    let actual = s.scanned[sku];
    if (actual === undefined) {
        if (quantity === '0' && confirmZero)
            actual = '0';
        else
            throw Error('请先记录实点数量；实物为 0 时请明确勾选确认');
    }
    if (format(units(actual)) !== quantity)
        throw Error('实点数量与 Cin7 可用数量不一致，不能采用基准');
    const original = s.originalExpected || s.expected;
    return normalizeBaselineOverride({ source: 'cin7', quantity, googleQuantity: original[sku] ?? '0', googlePresent: Object.prototype.hasOwnProperty.call(original, sku), warehouse: row.location, bin: row.bin || row.location, fetchedAt: result.fetchedAt, adoptedAt: new Date(now).toISOString(), physicalQuantity: actual, zeroConfirmed: quantity === '0' });
}
function adoptCin7Baseline(s, sku, result, confirmZero = false, now = Date.now()) {
    const baseline = cin7BaselineCandidate(s, sku, result, confirmZero, now);
    return { ...s, originalExpected: s.originalExpected || { ...s.expected }, expected: { ...s.expected, [sku]: baseline.quantity }, baselineOverrides: { ...s.baselineOverrides, [sku]: baseline }, scanned: s.scanned[sku] === undefined ? { ...s.scanned, [sku]: '0' } : { ...s.scanned }, ...(s.phase === 'finished' ? { checkedAt: baseline.adoptedAt } : {}) };
}
const baselineCSVHeaders = ['核对基准来源', '原 Google 基准数量', '原 Google 读取时间', '原 Google 版本', '采用的 Cin7 数量', 'Cin7 仓库', 'Cin7 库位', 'Cin7 读取时间', '采用时间', '采用时实点数量', '已确认实物为零'];
function baselineCSVValues(b, googleQuantity, snapshot) { return [b ? 'Cin7' : 'Google', b?.googleQuantity ?? googleQuantity, snapshot.fetchedAt, snapshot.version, b?.quantity ?? '', b?.warehouse ?? '', b?.bin ?? '', b?.fetchedAt ?? '', b?.adoptedAt ?? '', b?.physicalQuantity ?? '', b?.zeroConfirmed ? 'yes' : '']; }
function restore(raw) { const s = JSON.parse(raw); if (s === null)
    return null; if (!s || typeof s.location !== 'string' || !s.expected || !s.scanned || !s.labels || !s.snapshot?.version || !['scanning', 'finished'].includes(s.phase) || !Number.isInteger(s.round) || s.round < 1)
    throw Error('已保存的任务格式异常，请保留原记录'); if (s.completionCount !== undefined && (!Number.isSafeInteger(s.completionCount) || s.completionCount < 0))
    throw Error('复核记录格式异常'); if (s.recheckRequired !== undefined && typeof s.recheckRequired !== 'boolean')
    throw Error('复核记录格式异常'); if (s.recheckRequired && (s.completionCount !== 1 || s.phase !== 'scanning'))
    throw Error('复核记录格式异常'); for (const map of [s.expected, s.scanned, ...(s.originalExpected ? [s.originalExpected] : [])]) {
    for (const [sku, n] of Object.entries(map)) {
        if (!isInventorySku(sku) || typeof n !== 'string')
            throw Error('保存记录格式异常');
        units(n);
    }
} if (s.baselineOverrides) {
    if (!s.originalExpected || typeof s.baselineOverrides !== 'object' || Array.isArray(s.baselineOverrides))
        throw Error('Cin7 基准记录格式异常');
    for (const [sku, value] of Object.entries(s.baselineOverrides)) {
        const b = normalizeBaselineOverride(value);
        if (!/^[0-9]{4,5}$/.test(sku) || s.expected[sku] === undefined || format(units(s.expected[sku])) !== b.quantity || format(units(s.originalExpected[sku] ?? '0')) !== b.googleQuantity || Object.prototype.hasOwnProperty.call(s.originalExpected, sku) !== b.googlePresent || b.bin.toUpperCase() !== s.location.toUpperCase())
            throw Error('Cin7 基准记录格式异常');
        s.baselineOverrides[sku] = b;
    }
} return s; }
function exportCSV(s) {
    const cell = (x) => { let v = String(x ?? ''); if (/^[=+@\t\r]/.test(v) || (/^\-/.test(v) && !/^\-\d+(\.\d+)?$/.test(v)))
        v = "'" + v; return '"' + v.replaceAll('"', '""') + '"'; };
    const rows = [['库位', '数字SKU', '完整SKU', '基准数量', '实点数量', '差异', '结果', '轮次', '数量口径', '基准读取时间', '版本', '状态', '备注（其他库位）', '备注参考读取时间', '备注参考版本', ...baselineCSVHeaders]];
    for (const r of results(s))
        rows.push([s.location, r.sku, r.label, r.expected, r.actual, r.diff, r.status, s.round, s.baselineOverrides?.[r.sku] ? 'Cin7 · Available' : s.snapshot.quantityBasis, s.baselineOverrides?.[r.sku]?.fetchedAt ?? s.snapshot.fetchedAt, s.baselineOverrides?.[r.sku] ? 'cin7@' + s.baselineOverrides[r.sku].fetchedAt : s.snapshot.version, s.phase, r.status === '一致' ? '' : otherLocationHint(s, r.sku), r.status === '一致' ? '' : s.reference?.fetchedAt ?? '', r.status === '一致' ? '' : s.reference?.version ?? '', ...baselineCSVValues(s.baselineOverrides?.[r.sku], s.expected[r.sku] ?? '0', s.snapshot)]);
    return '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n');
}

function field(value, name, max, empty = false) { if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/.test(value) || (!empty && !value.trim()))
    throw Error(`Invalid ${name}`); return value.trim(); }
function iso(value, name) { const s = field(value, name, 64); if (!Number.isFinite(Date.parse(s)))
    throw Error(`Invalid ${name}`); return new Date(s).toISOString(); }
function normalizeReport(raw) {
    if (!raw || raw.schemaVersion !== 1)
        throw Error('Unsupported report version');
    const location = field(raw.location, 'location', 80).toUpperCase(), operator = field(raw.operator, 'operator', 80), deviceId = field(raw.deviceId, 'device ID', 64), deviceName = field(raw.deviceName, 'device name', 80);
    if (!/^d_[a-f0-9]{32}$/.test(deviceId))
        throw Error('Invalid device ID');
    if (!Number.isInteger(raw.round) || raw.round < 1 || raw.round > 10000)
        throw Error('Invalid round');
    if (!Array.isArray(raw.rows) || raw.rows.length < 1 || raw.rows.length > 2000)
        throw Error('Invalid report rows');
    const seen = new Set();
    const rows = raw.rows.map((r) => {
        const sku = field(r?.sku, 'SKU', 256);
        if (!isInventorySku(sku) || seen.has(sku))
            throw Error('Invalid or duplicate report SKU');
        seen.add(sku);
        const expected = format(units(field(r.expected, 'expected quantity', 32))), actual = r.actual === '' ? '' : format(units(field(r.actual, 'counted quantity', 32)));
        const baseline = r.baseline === undefined ? undefined : normalizeBaselineOverride(r.baseline);
        if (baseline && baseline.bin.toUpperCase() !== location)
            throw Error('Baseline location does not match report');
        if (baseline && baseline.quantity !== expected)
            throw Error('Baseline does not match expected quantity');
        const e = units(expected), a = units(actual || '0');
        if (!e && !a && !(baseline?.quantity === '0' && baseline.zeroConfirmed && actual === '0'))
            throw Error('Empty report row');
        const status = actual === '' ? '漏扫' : baseline ? (e === a ? '一致' : '数量不符') : e === 0n ? '多出' : e === a ? '一致' : '数量不符';
        return { sku, label: field(r.label, 'full SKU', 256), expected, actual, diff: format(a - e), status, note: status === '一致' ? '' : field(r.note ?? '', 'note', 12000, true), referenceFetchedAt: status === '一致' ? '' : field(r.referenceFetchedAt ?? '', 'reference time', 64, true), referenceVersion: status === '一致' ? '' : field(r.referenceVersion ?? '', 'reference version', 128, true), ...(baseline ? { baseline } : {}) };
    }).sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
    return { schemaVersion: 1, location, operator, deviceId, deviceName, round: raw.round, startedAt: iso(raw.startedAt, 'start time'), checkedAt: iso(raw.checkedAt, 'check time'), snapshot: { fetchedAt: iso(raw.snapshot?.fetchedAt, 'baseline time'), version: field(raw.snapshot?.version, 'baseline version', 128), quantityBasis: field(raw.snapshot?.quantityBasis, 'quantity basis', 80) }, rows };
}
function makeReport(s, profile) {
    if (s.recheckRequired)
        throw Error('首次核对有差异，请再次完成核对后上传。');
    if (s.phase !== 'finished' || !s.checkedAt)
        throw Error('请先完成本轮核对，再上传报告。');
    return normalizeReport({ schemaVersion: 1, location: s.location, ...profile, round: s.round, startedAt: s.startedAt, checkedAt: s.checkedAt, snapshot: s.snapshot, rows: results(s).map(r => ({ ...r, ...(s.baselineOverrides?.[r.sku] ? { baseline: s.baselineOverrides[r.sku] } : {}), note: r.status === '一致' ? '' : otherLocationHint(s, r.sku), referenceFetchedAt: s.reference?.fetchedAt ?? '', referenceVersion: s.reference?.version ?? '' })) });
}
function canonicalJSON(value) { if (value === null || typeof value !== 'object')
    return JSON.stringify(value); if (Array.isArray(value))
    return '[' + value.map(canonicalJSON).join(',') + ']'; return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJSON(value[k])).join(',') + '}'; }
async function reportId(p) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJSON(p))); return 'r_' + [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function reportSummary(p) { return { missing: p.rows.filter(r => r.status === '漏扫').length, extra: p.rows.filter(r => r.status === '多出').length, mismatch: p.rows.filter(r => r.status === '数量不符').length, matched: p.rows.filter(r => r.status === '一致').length, expectedTotal: format(p.rows.reduce((n, r) => n + units(r.expected), 0n)), countedTotal: format(p.rows.reduce((n, r) => n + units(r.actual || '0'), 0n)) }; }
function cloudReportCSV(p, id, receivedAt) {
    const rows = [['库位', '数字SKU', '完整SKU', '基准数量', '实点数量', '差异', '结果', '轮次', '数量口径', '基准读取时间', '版本', '状态', '备注（其他库位）', '备注参考读取时间', '备注参考版本', '报告编号', '操作者', '扫描器名称', '设备编号', '云端接收时间', ...baselineCSVHeaders]];
    for (const r of p.rows)
        rows.push([p.location, r.sku, r.label, r.expected, r.actual, r.diff, r.status, p.round, r.baseline ? 'Cin7 · Available' : p.snapshot.quantityBasis, r.baseline?.fetchedAt ?? p.snapshot.fetchedAt, r.baseline ? 'cin7@' + r.baseline.fetchedAt : p.snapshot.version, 'finished', r.note, r.referenceFetchedAt, r.referenceVersion, id, p.operator, p.deviceName, p.deviceId, receivedAt, ...baselineCSVValues(r.baseline, r.expected, p.snapshot)]);
    const cell = (v) => { let s = String(v ?? ''); if (/^[=+@\t\r]/.test(s) || (/^\-/.test(s) && !/^\-\d+(\.\d+)?$/.test(s)))
        s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
    return '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n');
}

const EN = {
    '库位核对 · Urbansales': 'Stock check · Urbansales', '库位核对首页': 'Stock check home', '关闭错误提示音': 'Mute error sound', '开启错误提示音': 'Enable error sound', '查看操作帮助': 'Open help', '库位扫描核对': 'Location stock check', '一个库位，一次核清。': 'One location. Every item accounted for.', '页面正在启动': 'Starting…', '如果此提示一直没有消失，说明页面程序未能启动，请使用下方「重新加载修复版」入口。': 'If this message stays visible, the app has not started. Use the reload link below.', '重新加载修复版': 'Reload the latest version', '浏览器需要启用 JavaScript 才能接收扫码。请让设备管理员检查浏览器设置。': 'JavaScript is required for scanning. Ask your device administrator to check the browser settings.', '关闭提示': 'Dismiss message',
    '选择库位': 'Choose a location', '输入 Location': 'Enter location', '例如 A01-01': 'e.g. A01-01', '开始核对 →': 'Start check →', '切换库位 →': 'Change location →', '库存自动读取，无需导入文件或连接电脑。': 'Inventory loads automatically. No file import or PC connection needed.', '当前任务的库存基准已固定，补扫不会改变。': 'This check uses a fixed inventory snapshot, including additional scans.', '准备好，开始第一个库位': 'Ready to check your first location', '输入库位后，按扫描键读取商品条码。': 'Enter a location, then use the scanner to read each item.', '每件商品扫描一次，系统自动保存并累计数量。': 'Scan each item once. Counts are saved and added automatically.', '输入库位': 'Enter location', '扫描商品': 'Scan items', '查看结果': 'View results', '应有 SKU 已记录': 'expected SKUs scanned', '商品数字 SKU': 'Numeric SKU barcode', '扫描的条码会显示在这里': 'Scanned barcode appears here', '识别条码': 'Read barcode', '只接受 4 / 5 位纯数字 SKU；每件扫一次，自动加 1。': '4- or 5-digit SKUs only. Each item scanned adds 1.', '手动输入': 'Manual input', '切回扫码': 'Back to scanning', '每次有效扫描自动计 1 件 · 实点累计': 'Each valid scan adds 1 · Total counted', '件': 'items', '尚未收到条码输入。若设备响了但这里没变化，请点右上角「?」检查键盘输出。': 'No barcode received yet. If the scanner beeps but nothing appears, open ? to check keyboard output.', '尚未收到条码输入。': 'No barcode received yet.', '已开始核对。尚未收到条码输入。': 'Check started. Waiting for a barcode.', '手动输入 SKU（每次识别也计 1 件）': 'Manual SKU input (each submission adds 1)', '例如：1719': 'e.g. 1719', '识别 SKU': 'Add SKU', '输入 4 / 5 位数字 SKU，再点「识别 SKU」，将直接保存并加 1。': 'Enter a 4- or 5-digit SKU and tap Add SKU to save it and add 1.',
    '核对明细': 'Check details', '↓ 导出报告': '↓ Export report', '只看差异 ↓': 'Differences only ↓', '显示全部 ↓': 'Show all ↓', '✓ 完成本轮核对': '✓ Finish this round', '↶ 继续补扫 · 保留原记录': '↶ Continue scanning · Keep counts', '库存同步': 'Inventory sync', '刷新库存': 'Refresh inventory', 'Google 库存表': 'Google inventory sheet', '自动同步 · 每 30 分钟': 'Automatic refresh · Every 30 minutes', '数量基准': 'Quantity basis', 'G 列 · Available': 'Column G · Available', '最近读取': 'Last fetched', '正在读取…': 'Loading…', '读取失败': 'Load failed', '可用库位': 'Available locations', '读取时间不代表上游报表的业务更新时间。': 'Fetch time is not the source report’s business update time.', '让每次核对，都简单一点。': 'Make every stock check simpler.', '逐件扫描': 'Scan every item', '只扫描包装上的 4 / 5 位数字 SKU。工厂长条码会被拦截。': 'Scan the 4- or 5-digit SKU on the packaging. Long factory barcodes are blocked.', '自动保存计数': 'Save counts automatically', '同一 SKU 每扫一次加 1，无需确认数量。请避免重扫同一件。': 'Every scan of the same SKU adds 1. No quantity confirmation. Avoid rescanning the same item.', '差异随时补核': 'Review and correct differences', '完成后可继续补扫，已有记录自动保留。': 'Continue scanning after finishing. Existing counts are kept.', '首次使用 DT50？ →': 'First time using DT50? →', '任务自动保存在当前设备和浏览器': 'Checks are saved in this device and browser',
    '关闭错误条码提示': 'Close invalid barcode message', '请扫描正确的 SKU 条码': 'Scan the correct SKU barcode', '只接受': 'Accepts only', '4 位或 5 位纯数字': '4 or 5 digits', '。请扫描包装上较短的 SKU 条码，不要扫描工厂长条码。': '. Scan the shorter SKU barcode on the packaging, not the long factory barcode.', '此次扫描未保存，数量未增加。': 'This scan was not saved. The count has not increased.', '直接重新扫描正确条码': 'Scan the correct barcode here', '扫描 4 / 5 位数字 SKU': 'Scan a 4- or 5-digit SKU', '返回扫描': 'Return to scanning', '取消此次扫描': 'Cancel this scan', '是这件商品吗？': 'Is this the right item?', '重新清点数量': 'Recount quantity', '不在当前库位应有清单中': 'Not expected at this location', '误扫请取消；确实在此的商品可记为多出。': 'Cancel if scanned by mistake. An item physically here can be recorded as extra.', '我确认该商品实物位于此库位': 'I confirm this item is physically at this location', '该 SKU 的实点总数量': 'Total counted quantity for this SKU', '实点总数量，使用下方数字键输入': 'Counted quantity; use the number pad below', '取消误扫': 'Cancel', '✓ 确认保存': '✓ Save quantity', '确认期间不接受下一次扫描，避免条码误填成数量。': 'Scanning is paused while editing a quantity.', '删除一位': 'Backspace', '修改数量': 'Edit quantity', '删除误扫': 'Delete mistaken scan',
    '关闭帮助': 'Close help', '扫描没有反应？看这里': 'Scanner not responding?', '①「开始核对」没有反应': '1. Start check does not respond', '页面需要正常加载程序。请使用当前修复版链接重新打开，不需要清除浏览器数据。': 'Reopen the latest app link. You do not need to clear browser data.', '② 设备响了，条码框却没有数字': '2. Scanner beeps, but no barcode appears', '在 DT50 扫描设置中选「Keystroke output / 键盘输出」。Intent / 广播输出不会把条码传给普通网页。然后点一下条码框再扫描。': 'In DT50 scan settings, select Keystroke output. Intent / broadcast output does not send barcodes to a normal webpage. Tap the barcode field and scan again.', '③ 框里有数字，但数量没有增加': '3. Barcode appears, but count does not increase', '输入停止后自动识别，或点条码框右侧箭头。正确的 4 / 5 位纯数字 SKU 直接保存并加 1，不会弹出数量确认窗口。': 'The app reads the barcode when input stops, or when you tap the arrow. A valid 4- or 5-digit SKU is saved and adds 1 without a quantity confirmation.', '仍然逐个库位核对。同一 SKU 每扫一次数量加 1，直接保存；漏扫可补扫，多扫可修改数量。工厂长条码不计数，弹窗后直接改扫正确短条码即可。': 'Check one location at a time. Each scan adds 1 and saves immediately. Scan missing items or edit overcounts. Factory barcodes do not count; scan the correct short SKU in the error dialog to continue.', '知道了，继续使用 →': 'Got it · Continue →',
    '正在更新库存': 'Refreshing inventory', '库存连接异常': 'Inventory connection error', '库存已连接': 'Inventory connected', '本轮已完成': 'Round complete', '本轮扫描已完成': 'This scanning round is complete', '已完成': 'Completed', '扫描中': 'Scanning', '核对通过': 'Check passed', '商品与录入数量均与库存基准一致。': 'All items and counted quantities match the inventory snapshot.', '查看下方差异，可继续补扫或修改数量。': 'Review the differences below. Continue scanning or edit quantities.', '扫描过程中显示当前差异': 'Current differences while scanning', '核对结果': 'Check results', '✓ 此筛选下没有商品': '✓ No items match this filter', '漏扫': 'Missing', '多出': 'Extra SKU', '数量不符': 'Quantity mismatch', '一致': 'Match', '待扫描': 'Not scanned', '基准': 'Expected', '实点': 'Counted', '差异': 'Difference', '备注 · 其他库位': 'Note · Other locations', '其他库位未查到该 SKU 的正可用数量（G 列）。': 'No positive available quantity found at other locations (column G).', '其他库位数据暂不可用，请刷新库存后查看。': 'Other-location data is unavailable. Refresh inventory and try again.', '未知 SKU': 'Unknown SKU', '未找到对应的完整 SKU': 'No matching full SKU found',
    '保存失败，本次操作未确认。请导出报告并检查设备存储空间。': 'Save failed. This action is not confirmed. Export the report and check device storage.', '库存读取失败': 'Could not load inventory', '库存响应格式异常': 'Invalid inventory response', '库存请求超时，请点刷新重试': 'Inventory request timed out. Tap refresh to retry', '网络连接失败': 'Network connection failed', '库存读取中，请稍候': 'Inventory is loading. Please wait', '请先等待库存连接成功': 'Wait for inventory to connect first', '新库位会替换当前任务，需要保留报告请先取消并导出。继续？': 'A new location replaces this check. Cancel and export first if you need its report. Continue?', '本库位核对通过，商品与录入数量均一致。': 'Check passed. All items and counted quantities match.', '补扫已开始，原计数保留；每件再扫一次会继续加 1，请勿重扫已清点的商品。': 'Additional scanning started. Existing counts are kept. Every scan adds 1; do not rescan items already counted.', '手动输入后按回车或点右侧箭头。': 'After typing, press Enter or tap the arrow.', '请在手动输入框填写数字 SKU，例如 1719。': 'Enter a numeric SKU in the manual field, e.g. 1719.', '已恢复上次核对，可继续操作。': 'Your previous check has been restored. You can continue.', '无法恢复或保存任务': 'Could not restore or save this check', '请先点击「继续补扫」': 'Tap Continue scanning first', '请扫描正确的 SKU 条码：只接受 4 位或 5 位纯数字，工厂长条码不计数': 'Scan the correct SKU: only 4 or 5 digits are accepted. Long factory barcodes do not count.', '当前核对已完成，请先继续补扫': 'This check is complete. Tap Continue scanning first', '条码格式错误': 'Invalid barcode format', '重复条码，未增加数量': 'Duplicate barcode; quantity was not increased', '该商品尚未记录': 'This item has not been recorded', '请勾选确认：该商品实物确实位于当前库位': 'Confirm that this item is physically at the current location', '请输入有效数量，最多 6 位小数': 'Enter a valid quantity, with up to 6 decimal places', '数量应大于 0，误扫请取消或删除记录': 'Quantity must be greater than 0. Cancel or delete a mistaken scan', '请先输入库位': 'Enter a location first', '已保存的任务格式异常，请保留原记录': 'Saved check data is invalid. Keep the original record', '保存记录格式异常': 'Invalid saved record format', '库存列结构已变化，请检查 B 列 Bin、C 列 SKU 和 G 列 Available': 'Inventory columns have changed. Check B: Bin, C: SKU and G: Available', '没有可核对的正数量库存': 'No positive inventory quantities are available', '相同库位号属于多个仓库': 'This location ID belongs to more than one warehouse', '库存来源暂时无法访问，请稍后重试': 'The inventory source is unavailable. Please try again later', '库存来源返回了网页，请检查发布链接': 'The inventory source returned a webpage. Check its published CSV link', '库存文件过大，请联系管理员': 'Inventory file is too large. Contact your administrator',
    '（不在当前库位应有清单中，已记为多出）': ' (not expected here; recorded as an extra SKU)', '（已超过基准数量）': ' (above expected quantity)',
    '库位': 'Location', '数字SKU': 'Numeric SKU', '完整SKU': 'Full SKU', '基准数量': 'Expected quantity', '实点数量': 'Counted quantity', '差额': 'Difference', '结果': 'Result', '轮次': 'Round', '数量口径': 'Quantity basis', '基准读取时间': 'Baseline fetched at', '版本': 'Version', '状态': 'Status', '备注（其他库位）': 'Notes (other locations)', '备注参考读取时间': 'Reference fetched at', '备注参考版本': 'Reference version'
};
Object.assign(EN, { '商品与实点数量符合当前采用的基准，Cin7 来源已逐项标记。': 'Items and counts match the currently adopted baselines. Cin7 sources are marked per SKU.' });
Object.assign(EN, { "Cin7 基准记录格式异常": "Invalid saved Cin7 baseline", "Cin7 基准需与确认的实点数量一致": "The Cin7 baseline must match the confirmed physical quantity", "Cin7 基准时间无效": "Invalid Cin7 baseline time", "Cin7 查询结果无法用于当前 SKU": "This Cin7 response cannot be used for the current SKU", "Cin7 查询已超过 5 分钟，请重新查询后采用": "The Cin7 query is over 5 minutes old. Query again before adopting it", "Cin7 当前库位不唯一或没有返回，不能采用基准": "Cin7 did not return one unique current location. The baseline cannot be adopted", "Cin7 当前库位可用数量缺失，不能采用基准": "Cin7 available quantity is missing. The baseline cannot be adopted", "Cin7 可用数量必须为非负有效数量": "Cin7 available quantity must be a valid non-negative number", "请先记录实点数量；实物为 0 时请明确勾选确认": "Record the physical count first. If it is zero, explicitly tick the confirmation", "实点数量与 Cin7 可用数量不一致，不能采用基准": "The counted quantity differs from Cin7 available stock. The baseline cannot be adopted", "当前任务已变化，请关闭后重新校对": "The current check has changed. Close this view and check again", "保存失败，尚未采用 Cin7 基准": "Save failed. The Cin7 baseline has not been adopted", "实点与当前库位 Cin7 可用数量一致，可采用该 SKU 的 Cin7 基准。": "The counted quantity matches Cin7 available stock at this location. You can adopt its baseline for this SKU.", "我已确认该库位该 SKU 的实物数量为 0": "I confirm the physical quantity of this SKU at this location is zero", "实物一致，采用 Cin7 基准": "Physical count matches · Adopt Cin7 baseline", "查询本身不改动数据。采用后仅更新本 SKU 的核对基准，保留原 Google 数量；不会回写 Google 或 Cin7 库存。": "Querying does not change data. Adopting updates only this SKU’s check baseline and keeps the original Google quantity. It does not update Google or Cin7 stock.", "初始 Google 基准已固定；可按 SKU 明确采用 Cin7 基准。": "The original Google baseline is fixed. A Cin7 baseline can be explicitly adopted per SKU.", "Cin7 按需辅助复核：查询不改动数据，实物一致时可单独采用该 SKU 的 Cin7 基准。": "Cin7 reference checks do not change data. Adopt its baseline per SKU only when the physical count matches.", "输出方式总被改回？": "Output mode keeps changing back?", "检查 ScanWedge 当前配置文件；其他应用可能改写输出方式。网页不能锁定设备输出模式。返回网页时会尝试恢复扫码框焦点。": "Check the active ScanWedge profile; other apps may change the output mode. A webpage cannot lock the device output mode. The scan field will try to regain focus when you return.", "核对基准来源": "Baseline source", "原 Google 基准数量": "Original Google quantity", "原 Google 读取时间": "Original Google fetched at", "原 Google 版本": "Original Google version", "采用的 Cin7 数量": "Adopted Cin7 quantity", "Cin7 仓库": "Cin7 warehouse", "Cin7 库位": "Cin7 bin", "Cin7 读取时间": "Cin7 fetched at", "采用时间": "Adopted at", "采用时实点数量": "Physical quantity at adoption", "已确认实物为零": "Zero physical quantity confirmed" });
Object.assign(EN, { "Cin7 正在连接…": "Connecting to Cin7…", "Cin7 暂不可用": "Cin7 unavailable", "Cin7 实时校对": "Cin7 live check", "Cin7 实时校对 · 待配置": "Cin7 live check · Not configured", "点击后查询该 SKU，不修改本轮基准或实点数量。": "Look up this SKU without changing the baseline or counted quantity.", "Cin7 按需辅助复核：仅点击差异 SKU 时查询，不改变 Google 盘点基准。": "Cin7 reference check: queried only when you click a differing SKU. The Google baseline stays unchanged.", "关闭 Cin7 校对": "Close Cin7 check", "正在查询 Cin7，请稍候…": "Querying Cin7. Please wait…", "仓库 / Location": "Warehouse / Location", "库位 / Bin": "Location / Bin", "可用 / Available": "Available", "在库 / On Hand": "On hand", "已分配 / Allocated": "Allocated", "在订 / On Order": "On order", "Cin7 未返回该 SKU 的库存记录。请核对完整 SKU；这不代表实物库存一定为 0。": "Cin7 returned no stock records for this SKU. Check the full SKU; this does not necessarily mean zero physical stock.", "页面仅显示前 200 个库位，当前库位优先。请在 Cin7 查看其余记录。": "Showing the first 200 locations, with the current location first. Check Cin7 for the remaining records.", "仅作辅助复核，不修改 Google 基准、实点数量或 Cin7 库存。查询时间不代表该时刻之后库存没有变化。": "Reference only. This does not change the Google baseline, your counts or Cin7 stock. Stock can change after the query time.", "再次查询 Cin7": "Query Cin7 again", "多个仓库存在同名库位，请按仓库分别核实。": "The same bin exists in multiple warehouses. Review each warehouse separately.", "Cin7 未返回当前库位库存行，不能据此直接判定为 0。": "Cin7 returned no row for this location. Do not assume its stock is zero.", "当前库位的可用数量字段缺失，请在 Cin7 核实。": "Available quantity is missing for this location. Check Cin7.", "Cin7 尚未配置，请联系管理者检查连接设置。": "Cin7 is not configured. Ask the manager to check connection settings.", "Cin7 拒绝了连接，请管理者检查 Account ID、Key 和库存读取权限。": "Cin7 rejected the connection. Ask the manager to check the account ID, key and stock read permission.", "已达到本系统的 Cin7 查询限额，请稍后再试。": "This app has reached its Cin7 request budget. Please retry later.", "Cin7 当前请求较多，请稍后再试。": "Cin7 is currently rate limited. Please retry later.", "该 SKU 正在查询中，请稍后再点一次。": "This SKU is already being queried. Please retry shortly.", "无法识别该 SKU 的完整编码，请检查商品资料。": "Could not identify the full SKU. Check the product record.", "Cin7 返回的数据无法可靠匹配该 SKU，本次未作数量判断。": "Cin7 data could not be reliably matched to this SKU. No quantity judgment was made.", "该 SKU 的库存记录过多，本次未展示不完整结果，请在 Cin7 核实。": "This SKU has too many stock records to display completely. Check Cin7.", "Cin7 返回的库存分页不完整，请稍后重试。": "Cin7 returned incomplete stock pages. Please retry later.", "页面会话已过期，请刷新页面后再查询。": "Your page session expired. Refresh before querying again.", "Cin7 连接超时或网络异常，请稍后重试。": "Cin7 timed out or the network failed. Please retry later.", "Cin7 查询超时，请稍后重试。": "Cin7 query timed out. Please retry later.", "Cin7 暂时无法返回库存，请稍后重试。": "Cin7 cannot return stock right now. Please retry later.", "Cin7 查询连接失败，请稍后重试。": "Cin7 lookup connection failed. Please retry later." });
Object.assign(EN, {
    '手动输入 SKU 和数量': 'Enter SKU and quantity manually', '数字 SKU': 'Numeric SKU', '本次增加数量': 'Quantity to add', '保存数量': 'Save quantity', '输入 4 / 5 位数字 SKU 和本次数量，点击保存；会累加到已有计数，不会覆盖。扫描枪每扫一次仍加 1。': 'Enter a 4- or 5-digit SKU and the quantity to add, then save. This adds to existing counts. Each scanner read still adds 1.', '本次增加数量必须大于 0': 'Quantity to add must be greater than 0', '匹配的库位': 'Matching locations', '输入 A01 可选择匹配库位；选好后点击开始核对。': 'Type A01 to choose a matching location, then start the check.', 'Cin7 按差异 SKU 辅助查询 · 待配置。Google 报表仍作为盘点基准。': 'Cin7 lookup for differing SKUs · Not configured. Google reports remain the check baseline.', 'Cin7 实时查询 · 待配置': 'Cin7 live lookup · Not configured', '配置 Cin7 连接后，可单独查询该差异 SKU；不改变 Google 盘点基准。': 'After configuring Cin7, look up this differing SKU without changing the Google check baseline.',
    '库存读取失败，两个读取入口均暂时不可用，请稍后刷新重试': 'Inventory could not be refreshed from either source. Please retry later', '库存同步失败，暂用上次读取的库存，仅供已有任务参考': 'Inventory sync failed. The last snapshot is shown for existing checks only',
    '云端报告': 'Cloud reports', '设置操作者 / 扫描器名称': 'Set operator / scanner name', '正在上传报告…': 'Uploading reports…', '✓ 已上传，再次检查': '✓ Uploaded · Check again', '报告已保存在本机，等待上传。': 'Report saved on this device, waiting to upload.', '↑ 上传 / 重试': '↑ Upload / Retry', '完成的报告可以上传到 PC 管理端。': 'Upload your completed report to the PC management console.', '完成本轮核对后将上传报告，已有扫描记录仍保留在本机。': 'Reports upload after finishing a round. Scanned counts stay on this device.', '↑ 上传报告': '↑ Upload report', '重试待上传报告': 'Retry pending reports', '首次填写操作者和扫描器名称，之后完成核对自动上传。补扫完成后会生成新报告，保留历史版本。': 'Set your operator and scanner name once. Finishing a check then uploads automatically. Each completed recount creates a new report and keeps previous versions.', '扫描记录本机保存 · 完成报告可上传共享': 'Counts saved locally · Completed reports can be shared', '报告署名设置': 'Report identification', '每台设备首次填写一次。管理者可以按操作者或扫描器筛选报告。': 'Set this once on each device. Managers can filter reports by operator or scanner.', '操作者': 'Operator', '扫描器名称': 'Scanner name', '例如：张三': 'e.g. Alex', '例如：DT50-01': 'e.g. DT50-01', '稍后设置': 'Set up later', '保存设置': 'Save settings', '此名称用于报告标识，不是登录身份认证。': 'Names identify reports and do not authenticate the operator.', '请填写操作者和扫描器名称。': 'Enter an operator and scanner name.', '名称不能超过 80 个字符。': 'Names must be 80 characters or fewer.', '设置保存失败，请检查设备存储空间。': 'Could not save settings. Check device storage.', '本机待上传报告保存失败，请先导出报告并检查存储空间。': 'Could not save the upload queue. Export your report and check storage.', '待上传报告已达 100 份，请先恢复网络完成上传。': '100 reports are waiting. Reconnect to upload them first.', '报告上传失败，请稍后重试。': 'Upload failed. Please retry later.', '云端报告服务尚未就绪，请稍后重试。': 'Cloud reports are not ready. Please retry later.', '上传回执未能保存在本机，稍后重试不会重复生成报告。': 'Could not save the receipt locally. Retrying will not create a duplicate report.', '上传超时，报告仍保留在本机，稍后将重试。': 'Upload timed out. The report stays on this device for retry.', '报告上传失败，请检查网络。': 'Upload failed. Check your connection.', '未能恢复上传设置或待上传报告，请保留浏览器数据。': 'Could not restore upload settings or reports. Keep the browser data.', '请先完成本轮核对，再上传报告。': 'Finish this round before uploading.', '上传授权已过期，请刷新页面后重试。': 'Upload session expired. Refresh the page and retry.', '报告校验失败，请重新提交。': 'Report validation failed. Submit it again.', '云端报告上传失败，已保留在本机，可稍后重试。': 'Cloud upload failed. Your report stays on this device for retry.', '报告上传失败，已保留在本机，请检查网络后重试。': 'Upload failed. Your report stays on this device. Check the connection and retry.', '报告编号': 'Report ID', '设备编号': 'Device ID', '云端接收时间': 'Cloud received at',
    '累计': 'Total', ' 件': ' items', '每扫一次 +1 · 自动保存': 'Each scan +1 · Auto saved', '等待扫描 SKU…': 'Waiting for SKU scan…', '开始核对': 'Start check', '切换库位': 'Change location', '展开': 'Expand', '收起': 'Collapse', '库位核对': 'Stock check', '库存详情': 'Stock details', '正在读取库存…': 'Loading inventory…', '后台同步中 · 可继续核对': 'Syncing · Check can continue', '库存同步异常': 'Inventory sync issue', '普通 SKU': 'Numeric SKU', '特殊 SKU': 'Special SKU', 'SKU 输入类型': 'SKU input type', '数字 SKU': 'Numeric SKU', '包含 Replacement 的完整 SKU': 'Full SKU containing Replacement', '保存': 'Save', '只看差异': 'Differences only', '显示全部': 'Show all', '云端报告与上传设置': 'Cloud reports and settings', '等待复核': 'Recheck needed', '已上传': 'Uploaded', '待上传': 'Upload queued', '本机保存': 'Saved on device', '等待上传': 'Awaiting upload', '录入 Replacement 数量': 'Enter Replacement quantity', 'SKU（数字或 Replacement）': 'SKU (numeric or Replacement)', '例如：1719 或 $Replacement…': 'e.g. 1719 or $Replacement…', '录入数量': 'Enter quantity', 'Replacement 商品请按实物核对数量': 'Count Replacement items physically.', '请填写 4 / 5 位数字 SKU 或包含 Replacement 的完整 SKU。': 'Enter a 4- or 5-digit SKU or the full SKU containing Replacement.', '手动输入只接受 4 / 5 位数字 SKU 或包含 Replacement 的 SKU': 'Manual entry accepts 4- or 5-digit SKUs or SKUs containing Replacement.', '输入 4 / 5 位数字 SKU 或包含 Replacement 的完整 SKU，再填写数量保存；也可点击 Replacement 商品旁的录入数量按钮。': 'Enter a numeric SKU or the full Replacement SKU and quantity, then save. You can also use the quantity button beside a Replacement item.', '正在后台更新库存': 'Refreshing inventory in background', '当前库位仍有未完成或尚未安全保存到上传队列的记录。切换会替换当前任务，继续？': 'This location has an unfinished check or a report not yet safely saved in the upload queue. Switching replaces the current check. Continue?', '展开全部已核对库位': 'Show all checked locations', '收起已核对库位': 'Collapse checked locations', '本设备已核对库位': 'Locations checked on this device', '暂无已核对库位': 'No locations checked yet', '最近完成核对：': 'Last completed: ', '已核对库位记录未能保存，请保留当前页面并检查设备存储空间。': 'Could not save completed locations. Keep this page open and check device storage.', '完成本轮核对': 'Finish this round', '完成复核并上传': 'Finish recheck and upload', '再次核对差异': 'Recheck differences', '等待再次核对': 'Waiting for recheck', '首次核对有差异，尚未上传。请复核差异后再次完成核对。': 'Differences found on the first check. Nothing uploaded. Review the differences and finish again.', '复核已完成，仍有差异，将上传当前报告。': 'Recheck complete. Differences remain; uploading the current report.', '首次核对有差异，请再次完成核对后上传。': 'Differences found on the first check. Finish the recheck before uploading.', '首次核对发现差异，报告暂不上传。请再次核对差异商品，再点击「完成复核并上传」。原计数已保留；补扫会继续加 1，请勿重扫已清点的商品。': 'Differences found on the first check. The report has not been uploaded. Recheck the affected items, then select “Finish recheck and upload”. Existing counts are retained. Each additional scan adds 1; do not rescan items already counted.',
    '新库位会替换当前任务，需要保留报告请先取消并上传或导出。继续？': 'A new location replaces this check. Cancel and upload or export the report first if you need to keep it. Continue?'
});
function toEnglish(value) {
    const leading = value.match(/^\s*/)?.[0] ?? '', trailing = value.match(/\s*$/)?.[0] ?? '', s = value.trim();
    let out = EN[s];
    if (out === undefined) {
        const rules = [
            [/^本机已核对 (\d+) 个库位$/, (n) => `${n} locations checked on this device`],
            [/^库存已同步 · (.*)$/, (time) => `Inventory synced · ${time}`],
            [/^录入数量 (.*)$/, (sku) => `Enter quantity ${sku}`],
            [/^库位库存数据异常：(.*)$/, (details) => `Location inventory data issue: ${details.replace(/第 (\d+) 行商品没有有效的 ~数字 后缀（(.*?)）/g, 'Row $1: missing ~numeric SKU suffix ($2)').replace(/SKU (\d+) 的 G 列数量无效或为负数（(.*?)）/g, 'SKU $1: invalid or negative column G quantity ($2)')}`],
            [/^初始 Google 基准读取：(.*)$/, (time) => `Original Google baseline fetched: ${time}`],
            [/^库位 (.+) · Google 原始基准 (.*) · 当前基准 (.*) · 实点 (.*)$/, (loc, google, current, actual) => `Location ${loc} · Original Google ${google} · Current expected ${current} · Counted ${actual}`],
            [/^基准来源 Cin7 · 原 Google ([\d.]+) → 采用 ([\d.]+) · 读取 (.*)$/, (google, quantity, time) => `Cin7 baseline · Original Google ${google} → Adopted ${quantity} · Fetched ${time}`],
            [/^已采用 SKU (\d+) 的 Cin7 基准：([\d.]+)；原 Google 数量和查询时间已保留。$/, (sku, quantity) => `Adopted Cin7 baseline for SKU ${sku}: ${quantity}. Original Google quantity and query time are retained.`],
            [/^库位 (.+) · Google 基准 (.*) · 实点 (.*)$/, (loc, expected, actual) => `Location ${loc} · Google expected ${expected} · Counted ${actual}`],
            [/^Cin7 当前库位可用数量：(.*)$/, (quantity) => `Cin7 available at this location: ${quantity}`],
            [/^Cin7 读取：(.*) · 本次 API 请求 (\d+)(.*)$/, (time, calls, cached) => `Cin7 fetched: ${time} · API requests: ${calls}${cached ? ' (reused result from the last 5 seconds)' : ''}`],
            [/^手动录入 (.+) · 已确认实物为 0 · 当前累计 ([\d.]+)$/, (sku, total) => `Manual entry ${sku} · Confirmed zero physical stock · Total ${total}`],
            [/^手动录入 (.+) · 增加 ([\d.]+) · 当前累计 ([\d.]+)(.*)$/, (sku, amount, total, tail) => `Manual entry ${sku} · Added ${amount} · Total ${total}${EN[tail] ?? tail}`],
            [/^本机有 (\d+) 份报告待上传，网络恢复后将自动重试。$/, (n) => `${n} reports are waiting on this device. Upload will retry when connected.`],
            [/^报告已上传 · (.*)$/, (time) => `Report uploaded · ${time}`],
            [/^第 (\d+) 轮 · 扫描中$/, (n) => `Round ${n} · Scanning`],
            [/^已保存 (\d+) · \+1 件 · 当前累计 ([\d.]+) 件(.*)$/, (sku, n, tail) => `Saved ${sku} · +1 item · Total ${n}${EN[tail] ?? tail}`],
            [/^已保存 (.+) × ([\d.]+)，请扫描下一款。$/, (sku, n) => `Saved ${sku} × ${n}. Scan the next item.`],
            [/^有 (\d+) 项需要复核，请查看差异。$/, (n) => `${n} differences need review. See the list below.`],
            [/^差异 ([-\d.]+)$/, (n) => `Difference ${n}`],
            [/^收到条码：(.*) · (.*)$/, (code, time) => `Barcode: ${code} · ${time.replace('上午', 'AM ').replace('下午', 'PM ')}`],
            [/^正在接收条码：(.*)$/, (code) => `Receiving barcode: ${code}`],
            [/^刚才读到：(.*)$/, (code) => `Barcode read: ${code}`],
            [/^当前核对基准：(.*)$/, (time) => `Check baseline: ${time}`],
            [/^参考读取：(.*?)(（与本轮核对基准版本不同）)?$/, (time, different) => `Reference fetched: ${time}${different ? ' (different from this check’s baseline version)' : ''}`],
            [/^其他库位（G 列可用数量）：(.*)$/, (locations) => 'Other locations (G · Available): ' + locations.replaceAll('（源数据异常，仅供参考）', ' (source data issue; reference only)').replaceAll('：', ': ').replaceAll('；', '; ')],
            [/^(\d+) 个$/, (n) => `${n} locations`],
            [/^修改数量 (.+)$/, (sku) => `Edit quantity ${sku}`],
            [/^删除误扫 (.+)$/, (sku) => `Delete mistaken scan ${sku}`],
            [/^删除 SKU (.+) 的扫描记录？删除后可重新扫描。$/, (sku) => `Delete the scan record for SKU ${sku}? You can scan it again afterwards.`],
            [/^已删除 (.+)，可以重新扫描。$/, (sku) => `Deleted ${sku}. You can scan it again.`],
            [/^URBANSALES · 逐件计数版 (v\d+)$/, (v) => `URBANSALES · Item counter ${v}`],
            [/^找不到 (.+) 的正数量库存，请检查库位$/, (loc) => `No positive inventory found at ${loc}. Check the location.`],
            [/^(.+) 源数据异常：(.+)$/, (loc, reason) => `Inventory data issue at ${loc}: ${toEnglish(reason)}`],
            [/^第 (\d+) 行商品没有有效的 ~数字 后缀$/, (row) => `Row ${row}: SKU has no valid ~digits suffix`],
            [/^SKU (\d+) 的 G 列数量无效或为负数（(.+)）$/, (sku, n) => `SKU ${sku}: invalid or negative quantity in column G (${n})`],
            [/^数字 SKU (\d+) 对应多个完整 SKU，需核实源数据$/, (sku) => `Numeric SKU ${sku} maps to multiple full SKUs. Check the source data.`],
            [/^第 (\d+) 行字段不足$/, (row) => `Row ${row} has missing fields`],
            [/^无法恢复或保存任务：(.*)。请保留浏览器原数据，暂勿开始新任务。$/, (reason) => `Could not restore or save the check: ${toEnglish(reason)}. Keep the original browser data and do not start a new check yet.`],
            [/^(.*)。已开始任务可按原基准继续，新任务需等待库存恢复。$/, (reason) => `${toEnglish(reason)}. Existing checks can continue with their original baseline. Wait for inventory to recover before starting a new check.`]
        ];
        for (const [pattern, replace] of rules) {
            const match = s.match(pattern);
            if (match) {
                out = replace(...match.slice(1));
                break;
            }
        }
    }
    return out === undefined ? value : leading + out + trailing;
}
function translateReport(csv, lang) {
    if (lang !== 'en')
        return csv;
    // Parse CSV locally so only labels/status/notes are translated; identifiers and quantities stay unchanged.
    const rows = [];
    let row = [], field = '', quoted = false;
    const text = csv.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (quoted && text[i + 1] === '"') {
                field += '"';
                i++;
            }
            else
                quoted = !quoted;
        }
        else if (c === ',' && !quoted) {
            row.push(field);
            field = '';
        }
        else if ((c === '\n' || c === '\r') && !quoted) {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        }
        else
            field += c;
    }
    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }
    rows.forEach((r, i) => { if (i === 0) {
        for (let j = 0; j < r.length; j++)
            r[j] = toEnglish(r[j]);
    }
    else {
        for (const j of [6, 8, 12])
            if (r[j])
                r[j] = toEnglish(r[j]);
        if (r[11])
            r[11] = r[11] === 'scanning' ? 'Scanning' : r[11] === 'finished' ? 'Completed' : r[11];
    } });
    return '\uFEFF' + rows.map(r => r.map(v => '"' + v.replaceAll('"', '""') + '"').join(',')).join('\r\n');
}
Object.assign(EN, { '数量（可填 0）': 'Quantity (0 allowed)', '零数量仅用于当前库位应有的 SKU；误扫的多出商品请删除记录': 'Zero is only allowed for an expected SKU at this location. Delete an accidentally scanned extra item.', '输入 4 / 5 位数字 SKU 或包含 Replacement 的完整 SKU，再填写数量保存。正数累加；输入 0 表示确认该 SKU 在本库位无实物，并将实点数量设为 0。': 'Enter a 4- or 5-digit SKU or a full Replacement SKU, then save its quantity. Positive quantities add to the count; 0 confirms no physical stock at this location and sets its counted quantity to 0.', 'URBANSALES · 逐件计数版 v20': 'URBANSALES · Item counting v20' });
