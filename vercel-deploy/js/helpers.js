import { SHIFT_START_MIN, GRACE_MIN } from './config.js';

export function uid() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export function localDateStr(d) {
    const off = d.getTimezoneOffset();
    const l = new Date(d.getTime() - off * 60000);
    return l.toISOString().slice(0, 10);
}

export function todayStr() {
    return localDateStr(new Date());
}

export function fmtTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(str) {
    const d = new Date(str + 'T00:00:00');
    return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateShort(str) {
    const d = new Date(str + 'T00:00:00');
    return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

export function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// export function isLateAt(d) {
//     const mins = d.getHours() * 60 + d.getMinutes();
//     return mins > SHIFT_START_MIN + GRACE_MIN;
// }

export function isSunday(dateStr) {
    return new Date(dateStr + 'T00:00:00').getDay() === 0;
}

export function roleLabel(r) {
    return {
        admin: 'Admin / Owner',
        area_manager: 'Area Manager',
        store_manager: 'Store Manager',
        sales_staff: 'Sales Staff'
    }[r] || r;
}

export function parseTimeToMinutes(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
}

export function scheduledShiftFor(store, shiftNumber) {
    if (!store) return null;
    const num = shiftNumber === 2 ? 2 : 1;
    const start = parseTimeToMinutes(store[`shift${num}Start`]);
    const end = parseTimeToMinutes(store[`shift${num}End`]);
    if (start == null || end == null) return null;
    return { startMin: start, endMin: end };
}

// UPDATED: now uses store + shift; falls back to global start if missing
export function isLateAt(d, store, shiftNumber) {
    const mins = d.getHours() * 60 + d.getMinutes();
    const sched = scheduledShiftFor(store, shiftNumber) || {
        startMin: SHIFT_START_MIN,
        endMin: SHIFT_START_MIN + 8 * 60
    };
    return mins > sched.startMin + GRACE_MIN;
}

export function computeUnderOverMinutes(rec, store) {
    if (!rec || !rec.checkInTime || !rec.checkOutTime) return null;
    const shiftNumber = rec.shift || 1;
    const sched = scheduledShiftFor(store, shiftNumber);
    if (!sched) return null;

    const start = new Date(rec.checkInTime);
    const end = new Date(rec.checkOutTime);
    const workedMin = Math.max(0, Math.round((end - start) / 60000));
    const scheduledMin = Math.max(0, sched.endMin - sched.startMin);
    return workedMin - scheduledMin;   // +ve = overtime, -ve = undertime
}