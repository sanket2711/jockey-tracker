import { STATE, RADIUS_M } from './config.js';
import { uid, todayStr, localDateStr, distanceMeters, isLateAt, isSunday } from './helpers.js';
import {
    loadKey, saveKey, seedData, storeIdsForUser,
    persistInstances, persistTemplates, persistAttendance,
    persistLeaves, persistUsers, persistStores
} from './services.js';
import {
    renderLogin, navItemsFor, pageTitle, pageSubtitle,
    renderDashboard, renderAttendancePage, renderTasksPage,
    renderLeavePage, renderReportsPage, renderTeamPage, renderStoresPage,
    openModal, closeModal, addEmployeeModal, addStoreModal
} from './views.js';

/* Export sub-lifecycle indicators out to templates safely */
export { todayStr, RADIUS_M };

export function todayRecordFor(userId) {
    return STATE.attendance.find(a => a.userId === userId && a.date === todayStr());
}

function geoOnce() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('Geolocation not supported.')); return; }
        navigator.geolocation.getCurrentPosition(pos => resolve(pos), err => reject(err), { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    });
}

export function ensureInstancesForDate(storeIds, date) {
    let changed = false;
    storeIds.forEach(sid => {
        STATE.taskTemplates.filter(t => t.storeId === sid && t.active).forEach(t => {
            if (!STATE.taskInstances.find(i => i.templateId === t.id && i.date === date)) {
                STATE.taskInstances.push({ id: uid(), templateId: t.id, storeId: sid, date, title: t.title, completed: false, completedBy: null, completedAt: null });
                changed = true;
            }
        });
    });
    if (changed) persistInstances();
    return changed;
}

export function monthlyReport(userId, monthDate) {
    const y = monthDate.getFullYear(), m = monthDate.getMonth();
    const today = new Date(); const isCurrentMonth = (today.getFullYear() === y && today.getMonth() === m);
    const lastDay = isCurrentMonth ? today.getDate() : new Date(y, m + 1, 0).getDate();
    let present = 0, late = 0, absent = 0, leave = 0;
    const rows = [];
    for (let d = 1; d <= lastDay; d++) {
        const dt = new Date(y, m, d); const ds = localDateStr(dt);
        if (isSunday(ds)) continue;
        const rec = STATE.attendance.find(a => a.userId === userId && a.date === ds);
        const onLeave = STATE.leaves.find(l => l.userId === userId && l.status === 'approved' && ds >= l.fromDate && ds <= l.toDate);
        let status;
        if (onLeave) { status = 'leave'; leave++; }
        else if (rec) { status = rec.late ? 'late' : 'present'; rec.late ? late++ : present++; }
        else { status = 'absent'; absent++; }
        rows.push({ date: ds, status, rec });
    }
    return { present, late, absent, leave, rows };
}

function showToast(msg) {
    STATE.toast = msg; render();
    setTimeout(() => { STATE.toast = null; render(); }, 2800);
}

/* Auth functions */
async function login(email, password) {
    const u = STATE.users.find(x => x.email.toLowerCase() === email.trim().toLowerCase() && x.password === password && x.active !== false);
    if (!u) return false;
    STATE.user = u; STATE.page = 'dashboard';
    await saveKey('session', u.id, false);
    return true;
}

async function logout() {
    STATE.user = null;
    await saveKey('session', null, false);
    render();
}

/* Master Engine Orchestrator Lifecycle */
export function render() {
    const root = document.getElementById('root');
    if (!STATE.ready) {
        root.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;color:#8992A1;font-family:Inter,sans-serif;">Loading ShiftLedger…</div>';
        return;
    }
    if (!STATE.user) {
        root.innerHTML = renderLogin();
        attachLoginEvents();
        return;
    }

    const u = STATE.user;
    const nav = navItemsFor(u.role).map(([id, label]) =>
        `<div class="nav-item ${STATE.page === id ? 'active' : ''}" data-page="${id}"><span class="nav-dot"></span>${label}</div>`
    ).join('');

    root.innerHTML = `
  <div class="app">
    <div class="sidebar ${STATE.navOpen ? 'open' : ''}" id="sidebar">
      <div class="brand-mark"><div class="brand-clock"></div><div><div class="brand-name">SHIFTLEDGER</div><div class="brand-sub">Store Ops</div></div></div>
      ${nav}
      <div class="sidebar-foot">
        <div class="who">${u.name}</div>
        <div class="who-role">${u.role}</div>
        <div class="logout-link" id="logoutBtn">Sign out</div>
      </div>
    </div>
    <div class="main">
      <div class="topbar">
        <div><h1>${pageTitle(STATE.page)}</h1><div class="ctx">${pageSubtitle(u)}</div></div>
        <div class="clock-live" id="liveClock"></div>
      </div>
      <div class="content">${renderPage()}</div>
    </div>
  </div>
  ${STATE.toast ? `<div class="toast">${STATE.toast}</div>` : ''}
  `;
    attachAppEvents();
}

function renderPage() {
    switch (STATE.page) {
        case 'dashboard': return renderDashboard();
        case 'attendance': return renderAttendancePage();
        case 'tasks': return renderTasksPage();
        case 'leave': return renderLeavePage();
        case 'reports': return renderReportsPage();
        case 'team': return renderTeamPage();
        case 'stores': return renderStoresPage();
        default: return '';
    }
}

/* DOM Action Handlers & Event Hooks */
function attachLoginEvents() {
    document.getElementById('loginForm').addEventListener('submit', async e => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value, pass = document.getElementById('loginPassword').value;
        const ok = await login(email, pass);
        if (!ok) { document.getElementById('loginError').innerHTML = '<div class="error-box">Email or password not recognized.</div>'; }
        else render();
    });
    document.querySelectorAll('.demo-row').forEach(row => {
        row.addEventListener('click', () => {
            document.getElementById('loginEmail').value = row.dataset.email;
            document.getElementById('loginPassword').value = row.dataset.pass;
        });
    });
}

function attachAppEvents() {
    document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', () => { STATE.page = el.dataset.page; STATE.punchStatus = ''; STATE.punchOk = null; render(); }));
    const logoutBtn = document.getElementById('logoutBtn'); if (logoutBtn) logoutBtn.addEventListener('click', logout);

    const punchInBtn = document.getElementById('punchInBtn'); if (punchInBtn) punchInBtn.addEventListener('click', handlePunchIn);
    const punchOutBtn = document.getElementById('punchOutBtn'); if (punchOutBtn) punchOutBtn.addEventListener('click', handlePunchOut);

    document.querySelectorAll('[data-toggle]').forEach(el => el.addEventListener('click', async () => {
        const inst = STATE.taskInstances.find(i => i.id === el.dataset.toggle); if (!inst) return;
        inst.completed = !inst.completed;
        inst.completedBy = inst.completed ? STATE.user.id : null;
        inst.completedAt = inst.completed ? new Date().toISOString() : null;
        await persistInstances(); render();
    }));

    document.querySelectorAll('[data-addtask]').forEach(el => el.addEventListener('click', async () => {
        const sid = el.dataset.addtask; const inp = document.getElementById('taskInput_' + sid);
        if (!inp.value.trim()) return;
        STATE.taskTemplates.push({ id: uid(), storeId: sid, title: inp.value.trim(), active: true });
        await persistTemplates();
        ensureInstancesForDate([sid], todayStr());
        render();
    }));

    document.querySelectorAll('[data-removetpl]').forEach(el => el.addEventListener('click', async () => {
        const t = STATE.taskTemplates.find(x => x.id === el.dataset.removetpl); if (!t) return;
        t.active = false; await persistTemplates(); render();
    }));

    const leaveForm = document.getElementById('leaveForm');
    if (leaveForm) leaveForm.addEventListener('submit', async e => {
        e.preventDefault();
        const fromDate = document.getElementById('leaveFrom').value, toDate = document.getElementById('leaveTo').value, reason = document.getElementById('leaveReason').value;
        if (!fromDate || !toDate || fromDate > toDate) return showToast('Check your leave dates.');
        STATE.leaves.push({ id: uid(), userId: STATE.user.id, storeId: STATE.user.storeId, fromDate, toDate, reason: reason.trim(), status: 'pending', requestedAt: new Date().toISOString() });
        await persistLeaves(); showToast('Leave request submitted.'); render();
    });

    document.querySelectorAll('[data-approve]').forEach(el => el.addEventListener('click', async () => {
        const l = STATE.leaves.find(x => x.id === el.dataset.approve); if (!l) return;
        l.status = 'approved'; l.decidedBy = STATE.user.id; l.decidedAt = new Date().toISOString();
        await persistLeaves(); render();
    }));

    document.querySelectorAll('[data-reject]').forEach(el => el.addEventListener('click', async () => {
        const l = STATE.leaves.find(x => x.id === el.dataset.reject); if (!l) return;
        l.status = 'rejected'; l.decidedBy = STATE.user.id; l.decidedAt = new Date().toISOString();
        await persistLeaves(); render();
    }));

    document.querySelectorAll('[data-month]').forEach(el => el.addEventListener('click', () => {
        const d = new Date(STATE.month); d.setMonth(d.getMonth() + parseInt(el.dataset.month)); STATE.month = d; render();
    }));

    const addEmpBtn = document.getElementById('addEmployeeBtn'); if (addEmpBtn) addEmpBtn.addEventListener('click', () => addEmployeeModal(render, showToast, uid));
    const addStoreBtn = document.getElementById('addStoreBtn'); if (addStoreBtn) addStoreBtn.addEventListener('click', () => addStoreModal(render, showToast, uid, geoOnce));

    document.querySelectorAll('[data-toggleactive]').forEach(el => el.addEventListener('click', async () => {
        const u = STATE.users.find(x => x.id === el.dataset.toggleactive); u.active = u.active === false;
        await persistUsers(); render();
    }));

    if (document.getElementById('liveClock')) tickClock();
}

async function handlePunchIn() {
    const u = STATE.user, store = STATE.stores.find(s => s.id === u.storeId);
    if (!store) { STATE.punchStatus = 'No store assigned.'; STATE.punchOk = false; render(); return; }
    STATE.punchStatus = 'Getting location…'; STATE.punchOk = null; render();
    try {
        const pos = await geoOnce(); const { latitude, longitude, accuracy } = pos.coords;
        const dist = distanceMeters(latitude, longitude, store.lat, store.lng);
        if (dist > RADIUS_M) { STATE.punchStatus = `You're ${Math.round(dist)}m away.`; STATE.punchOk = false; render(); return; }
        const now = new Date();
        STATE.attendance.push({ id: uid(), userId: u.id, storeId: store.id, date: localDateStr(now), checkInTime: now.toISOString(), checkInLoc: { lat: latitude, lng: longitude, accuracy: Math.round(accuracy) }, checkOutTime: null, checkOutLoc: null, late: isLateAt(now) });
        await persistAttendance(); STATE.punchStatus = `Punched in successfully.`; STATE.punchOk = true; render();
    } catch(err) { STATE.punchStatus = 'Location error: ' + (err.message || 'denied.'); STATE.punchOk = false; render(); }
}

async function handlePunchOut() {
    const u = STATE.user, store = STATE.stores.find(s => s.id === u.storeId), rec = todayRecordFor(u.id);
    if (!rec || rec.checkOutTime) return;
    STATE.punchStatus = 'Getting location…'; STATE.punchOk = null; render();
    try {
        const pos = await geoOnce(); const { latitude, longitude, accuracy } = pos.coords;
        const dist = distanceMeters(latitude, longitude, store.lat, store.lng);
        if (dist > RADIUS_M) { STATE.punchStatus = `You're ${Math.round(dist)}m away.`; STATE.punchOk = false; render(); return; }
        const now = new Date(); rec.checkOutTime = now.toISOString(); rec.checkOutLoc = { lat: latitude, lng: longitude, accuracy: Math.round(accuracy) };
        await persistAttendance(); STATE.punchStatus = `Punched out successfully.`; STATE.punchOk = true; render();
    } catch(err) { STATE.punchStatus = 'Location error: ' + (err.message || 'denied.'); STATE.punchOk = false; render(); }
}

let clockInterval = null;
function tickClock() {
    if (clockInterval) clearInterval(clockInterval);
    const update = () => { const el = document.getElementById('liveClock'); if (el) el.textContent = new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
    update(); clockInterval = setInterval(update, 1000);
}

/* System Bootstrapper Init Engine */
async function init() {
    let [stores, users, taskTemplates, attendance, taskInstances, leaves] = await Promise.all([
        loadKey('stores', true), loadKey('users', true), loadKey('task_templates', true),
        loadKey('attendance', true), loadKey('task_instances', true), loadKey('leaves', true)
    ]);
    if (!stores || !users) {
        const seed = seedData();
        stores = seed.stores; users = seed.users; taskTemplates = seed.taskTemplates;
        attendance = []; taskInstances = []; leaves = [];
        await Promise.all([saveKey('stores', stores, true), saveKey('users', users, true), saveKey('task_templates', taskTemplates, true), saveKey('attendance', attendance, true), saveKey('task_instances', taskInstances, true), saveKey('leaves', leaves, true)]);
    }
    STATE.stores = stores || []; STATE.users = users || []; STATE.taskTemplates = taskTemplates || [];
    STATE.attendance = attendance || []; STATE.taskInstances = taskInstances || []; STATE.leaves = leaves || [];
    const sessionId = await loadKey('session', false);
    if (sessionId) { const u = STATE.users.find(x => x.id === sessionId); if (u) STATE.user = u; }
    STATE.ready = true;
    render();
}

init();