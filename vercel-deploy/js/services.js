import { STATE, BACKEND_API_URL, API_KEY } from './config.js';
import { DAY_KEYS, distanceMeters } from './helpers.js';

// ─── Local (non-shared) storage helpers ──────────────────────────────────────
export async function saveKey(key, value, shared) {
    try {
        if (!shared) {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(value));
            return true;
        }
        const response = await fetch(`${BACKEND_API_URL}/api/storage/${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
            body: JSON.stringify({ value })
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Save ${key} failed: ${response.status} ${text}`);
        }
        return true;
    } catch (e) {
        console.error('Save failed', key, e);
        return false;
    }
}

export async function loadKey(key, shared) {
    if (!shared) {
        const localData = localStorage.getItem(key);
        return localData ? JSON.parse(localData) : null;
    }
    // Kept only for non-sensitive keys (e.g. 'stores' during seed check)
    try {
        const response = await fetch(`${BACKEND_API_URL}/api/storage/${key}`, {
            headers: { 'x-api-key': API_KEY }
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.error('Load failed', key, e);
        return null;
    }
}

// ─── NEW: Single scoped data load — one request, server filters by userId ────
// Returns { stores, users, task_templates, attendance, task_instances, leaves, duty_rosters }
// Everything is pre-filtered on the server for the user's role and store scope.
export async function loadScopedData(userId) {
    try {
        const response = await fetch(`${BACKEND_API_URL}/api/data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) {
            console.error('Scoped data load failed', response.status);
            return null;
        }
        return await response.json();
    } catch (e) {
        console.error('Scoped data load failed', e);
        return null;
    }
}

export async function loginRequest(email, password) {
    try {
        const response = await fetch(`${BACKEND_API_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
            body: JSON.stringify({ email, password })
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.error('Login failed', e);
        return null;
    }
}

export const persistStores     = () => saveKey('stores',         STATE.stores,        true);
export const persistUsers      = () => saveKey('users',          STATE.users,         true);
export const persistTemplates  = () => saveKey('task_templates', STATE.taskTemplates, true);
export const persistInstances  = () => saveKey('task_instances', STATE.taskInstances, true);
export const persistAttendance = () => saveKey('attendance',     STATE.attendance,    true);
export const persistLeaves     = () => saveKey('leaves',         STATE.leaves,        true);
export const persistDutyRosters= () => saveKey('duty_rosters',  STATE.dutyRosters,   true);

export function seedData() {
    const stores = [
        { id: 'st_a', name: 'S89 - Seasons Mall',  address: 'Seasons Mall, Hadapsar, Pune', lat: 18.515734050581795, lng: 73.94694155262285, shift1Start: '10:30', shift1End: '20:30', shift2Start: '12:00', shift2End: '22:00' },
        { id: 'st_b', name: 'M45 - Eon Kharadi',   address: 'Eon IT Park, Kharadi, Pune',   lat: 18.5590, lng: 73.7868, shift1Start: '10:00', shift1End: '20:00', shift2Start: '11:30', shift2End: '21:30' },
        { id: 'st_c', name: 'MT7 - Nyati Plaza',   address: 'Nyati Plaza, Kharadi, Pune',   lat: 18.5074, lng: 73.8077, shift1Start: '10:30', shift1End: '20:30', shift2Start: '12:00', shift2End: '22:00' },
        { id: 'st_d', name: 'M43 - Baramati',      address: 'Main Road, Baramati',          lat: 18.5679, lng: 73.9143, shift1Start: '10:00', shift1End: '20:00', shift2Start: '11:30', shift2End: '21:30' }
    ];
    const users = [
        { id: 'u_admin1',   name: 'Sanket Baheti',    email: 'sanket.baheti',    password: 'admin123',   role: 'admin',         storeId: null,   storeIds: null, active: true },
        { id: 'u_area1',    name: 'Dinesh Pardeshi',  email: 'dinesh.pardeshi',  password: 'area123',    role: 'area_manager',  storeId: null,   storeIds: ['st_a','st_b','st_c','st_d'], active: true },
        { id: 'u_mgr_a',    name: 'Sundar Maske',     email: 'sundar.maske',     password: 'manager123', role: 'store_manager', storeId: 'st_a', storeIds: null, active: true },
        { id: 'u_mgr_b',    name: 'Omkar Shinde',     email: 'omkar.shinde',     password: 'manager123', role: 'store_manager', storeId: 'st_b', storeIds: null, active: true },
        { id: 'u_mgr_c',    name: 'Kalyan More',      email: 'kalyan.more',      password: 'manager123', role: 'store_manager', storeId: 'st_c', storeIds: null, active: true },
        { id: 'u_mgr_d',    name: 'Dinesh Vedpathak', email: 'dinesh.vedpathak', password: 'manager123', role: 'store_manager', storeId: 'st_d', storeIds: null, active: true },
        { id: 'u_staff_1',  name: 'Adarsh Palkhe',    email: 'adarsh.palkhe',    password: 'staff123',   role: 'sales_staff',   storeId: 'st_a', storeIds: null, active: true },
        { id: 'u_staff_2',  name: 'Aarti Giri',       email: 'aarti.giri',       password: 'staff123',   role: 'sales_staff',   storeId: 'st_a', storeIds: null, active: true },
        { id: 'u_staff_3',  name: 'Ranita Karji',     email: 'ranita.karji',     password: 'staff123',   role: 'sales_staff',   storeId: 'st_a', storeIds: null, active: true },
        { id: 'u_staff_4',  name: 'Reshma Ali',       email: 'reshma.ali',       password: 'staff123',   role: 'sales_staff',   storeId: 'st_a', storeIds: null, active: true },
        { id: 'u_staff_5',  name: 'Tulshiram Shelar', email: 'tulshiram.shelar', password: 'staff123',   role: 'sales_staff',   storeId: 'st_a', storeIds: null, active: true },
        { id: 'u_staff_6',  name: 'Amol Chavan',      email: 'amol.chavan',      password: 'staff123',   role: 'sales_staff',   storeId: 'st_b', storeIds: null, active: true },
        { id: 'u_staff_7',  name: 'Datta Dombe',      email: 'datta.dombe',      password: 'staff123',   role: 'sales_staff',   storeId: 'st_b', storeIds: null, active: true },
        { id: 'u_staff_8',  name: 'Karuna Sawant',    email: 'karuna.sawant',    password: 'staff123',   role: 'sales_staff',   storeId: 'st_b', storeIds: null, active: true },
        { id: 'u_staff_9',  name: 'Trupti Satam',     email: 'trupti.satam',     password: 'staff123',   role: 'sales_staff',   storeId: 'st_b', storeIds: null, active: true },
        { id: 'u_staff_10', name: 'Sagar Ahir',       email: 'sagar.ahir',       password: 'staff123',   role: 'sales_staff',   storeId: 'st_b', storeIds: null, active: true },
        { id: 'u_staff_11', name: 'Supriya Kinagi',   email: 'supriya.kinagi',   password: 'staff123',   role: 'sales_staff',   storeId: 'st_b', storeIds: null, active: true },
        { id: 'u_staff_12', name: 'Achal Kumar',      email: 'achal.kumar',      password: 'staff123',   role: 'sales_staff',   storeId: 'st_c', storeIds: null, active: true },
        { id: 'u_staff_13', name: 'Sheetal Pawar',    email: 'sheetal.pawar',    password: 'staff123',   role: 'sales_staff',   storeId: 'st_c', storeIds: null, active: true },
        { id: 'u_staff_14', name: 'Shrabani Sarkar',  email: 'shrabani.sarkar',  password: 'staff123',   role: 'sales_staff',   storeId: 'st_c', storeIds: null, active: true },
        { id: 'u_staff_15', name: 'Hina',             email: 'hina',             password: 'staff123',   role: 'sales_staff',   storeId: 'st_d', storeIds: null, active: true },
        { id: 'u_staff_16', name: 'Mayuri',           email: 'mayuri',           password: 'staff123',   role: 'sales_staff',   storeId: 'st_d', storeIds: null, active: true },
        { id: 'u_staff_17', name: 'Pranav',           email: 'pranav',           password: 'staff123',   role: 'sales_staff',   storeId: 'st_d', storeIds: null, active: true },
        { id: 'u_staff_18', name: 'Yash',             email: 'yash',             password: 'staff123',   role: 'sales_staff',   storeId: 'st_d', storeIds: null, active: true }
    ];
    const taskTitles = ['Open store & turn on system', 'Clean & organize display', 'Close store & lock up'];
    const taskTemplates = [];
    stores.forEach(st => {
        taskTitles.forEach((t, i) => {
            taskTemplates.push({ id: 'tt_' + st.id + '_' + i, storeId: st.id, title: t, active: true, assignedTo: null, recurrence: { type: 'daily' } });
        });
    });
    return { stores, users, taskTemplates };
}

export function storesForUser(u) {
    if (!u) return [];
    if (u.role === 'admin') return STATE.stores;
    if (u.role === 'area_manager') return STATE.stores.filter(s => (u.storeIds || []).includes(s.id));
    if (u.role === 'store_manager' || u.role === 'sales_staff') return STATE.stores.filter(s => s.id === u.storeId);
    return [];
}

export function storeIdsForUser(u) { return storesForUser(u).map(s => s.id); }

export function employeesForUser(u) {
    const ids = storeIdsForUser(u);
    if (u.role === 'admin') return STATE.users.filter(x => x.role !== 'admin');
    if (u.role === 'area_manager') return STATE.users.filter(x => ids.includes(x.storeId));
    if (u.role === 'store_manager') return STATE.users.filter(x => x.storeId === u.storeId && x.role === 'sales_staff');
    return [];
}

export function teamForUser(u) {
    if (!u) return [];
    const ids = storeIdsForUser(u);
    if (u.role === 'admin') return STATE.users.filter(x => x.role !== 'admin');
    if (u.role === 'area_manager') {
        return STATE.users.filter(x =>
            x.role !== 'admin' &&
            (ids.includes(x.storeId) || x.id === u.id)
        );
    }
    if (u.role === 'store_manager') {
        return STATE.users.filter(x => x.storeId === u.storeId && x.role === 'sales_staff');
    }
    return [];
}

export function todayStoreIdFor(userId, attendance, dateStr) {
    const rec = attendance.find(a => a.userId === userId && a.date === dateStr);
    return rec ? rec.storeId : null;
}

export function storeName(id) { const s = STATE.stores.find(x => x.id === id); return s ? s.name : '—'; }
export function userName(id)  { const u = STATE.users.find(x => x.id === id);  return u ? u.name : 'Unknown'; }

export function nearestStore(lat, lng) {
    let nearest = null, nearestDist = Infinity;
    STATE.stores.forEach(s => {
        const d = distanceMeters(lat, lng, s.lat, s.lng);
        if (d < nearestDist) { nearestDist = d; nearest = s; }
    });
    return nearest ? { store: nearest, distance: nearestDist } : null;
}

export function authorizedStoreIdsFor(u) {
    if (u.role === 'area_manager') return u.storeIds || [];
    if (u.storeId) return [u.storeId];
    return [];
}

export function isApproverForRecord(approverIds, rec) {
    return approverIds.includes(rec.storeId) || (rec.homeStoreId && approverIds.includes(rec.homeStoreId));
}

export function activeStaffForStore(storeId) {
    return STATE.users.filter(u => u.active !== false && u.storeId === storeId);
}

export function approvedLeaveForDay(userId, dateStr) {
    return STATE.leaves.find(l => l.userId === userId && l.status === 'approved' && dateStr >= l.fromDate && dateStr <= l.toDate);
}

export function rosterFor(storeId, weekStart) {
    return STATE.dutyRosters.find(r => r.type === 'store' && r.storeId === storeId && r.weekStart === weekStart);
}

export function amRosterFor(userId, weekStart) {
    return STATE.dutyRosters.find(r => r.type === 'am' && r.userId === userId && r.weekStart === weekStart);
}

export function amVisitsForStore(storeId, weekStart) {
    return STATE.dutyRosters
        .filter(r => r.type === 'am' && r.weekStart === weekStart && r.status !== 'draft')
        .map(r => {
            const visitDays = DAY_KEYS.filter(dk => r.days[dk] && r.days[dk].storeId === storeId);
            return visitDays.length ? { amId: r.userId, days: visitDays, entries: r.days } : null;
        })
        .filter(Boolean);
}
