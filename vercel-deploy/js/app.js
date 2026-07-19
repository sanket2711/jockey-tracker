import { STATE, RADIUS_M } from './config.js';
import {uid, todayStr, localDateStr, distanceMeters, isLateAt, computeUnderOverMinutes} from './helpers.js';
import {
    loadKey, saveKey, seedData, employeesForUser,
    persistInstances, persistTemplates, persistAttendance,
    persistLeaves, persistUsers, persistStores, loadUsersSafe, loginRequest
} from './services.js';
import {
    renderLogin, navItemsFor, pageTitle, pageSubtitle,
    renderDashboard, renderAttendancePage, renderTasksPage,
    renderLeavePage, renderReportsPage, renderTeamPage, renderStoresPage,
    addEmployeeModal, addStoreModal, manualPunchModal,
    editEmployeeModal, editStoreModal, createTaskModal
} from './views.js';

/* Export sub-lifecycle indicators out to templates safely */
export { todayStr, RADIUS_M };

export function todayRecordFor(userId) {
    return STATE.attendance.find(a => a.userId === userId && a.date === todayStr());
}

/* Punch approval helpers — records with no approvalStatus are legacy/normal punches (treated as approved) */
export function isPunchPending(rec) {
    return !!rec && rec.approvalStatus === 'pending';
}
export function isPunchRejected(rec) {
    return !!rec && rec.approvalStatus === 'rejected';
}
export function isPunchCountable(rec) {
    return !!rec && (!rec.approvalStatus || rec.approvalStatus === 'approved');
}

function geoOnce() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('Geolocation not supported.')); return; }
        navigator.geolocation.getCurrentPosition(pos => resolve(pos), err => reject(err), { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    });
}

export function ensureInstancesForDate(storeIds, date) {
    let changed = false;
    const d = new Date(date);
    const dayOfWeek = d.getDay(); // 0-6
    const dayOfMonth = d.getDate();

    storeIds.forEach(sid => {
        STATE.taskTemplates.filter(t => t.storeId === sid && t.active).forEach(t => {
            let shouldRun = false;
            const r = t.recurrence || { type: 'daily' };
            if (r.type === 'daily') shouldRun = true;
            else if (r.type === 'weekly' && r.days && r.days.includes(dayOfWeek)) shouldRun = true;
            else if (r.type === 'monthly' && r.dayOfMonth === dayOfMonth) shouldRun = true;
            else if (!r.type) shouldRun = true;

            if (shouldRun) {
                if (!STATE.taskInstances.find(i => i.templateId === t.id && i.date === date)) {
                    STATE.taskInstances.push({
                        id: uid(), templateId: t.id, storeId: sid, date, title: t.title,
                        assignedTo: t.assignedTo || null, completed: false, completedBy: null, completedAt: null
                    });
                    changed = true;
                }
            }
        });
    });
    if (changed) persistInstances();
    return changed;
}

export function monthlyReport(userId, monthDate) {
    const y = monthDate.getFullYear(), m = monthDate.getMonth();
    const today = new Date();
    const isCurrentMonth = (today.getFullYear() === y && today.getMonth() === m);
    const lastDay = isCurrentMonth ? today.getDate() : new Date(y, m + 1, 0).getDate();

    let present = 0, late = 0, absent = 0, leave = 0;
    let totalUnderMin = 0, totalOverMin = 0;
    const rows = [];

    for (let d = 1; d <= lastDay; d++) {
        const dt = new Date(y, m, d); const ds = localDateStr(dt);
        const rec = STATE.attendance.find(a => a.userId === userId && a.date === ds);
        const onLeave = STATE.leaves.find(l =>
            l.userId === userId && l.status === 'approved' && ds >= l.fromDate && ds <= l.toDate
        );

        let status;
        if (onLeave) {
            status = 'leave'; leave++;
        } else if (isPunchPending(rec)) {
            status = 'pending';
        } else if (isPunchCountable(rec)) {
            status = rec.late ? 'late' : 'present';
            rec.late ? late++ : present++;

            const store = rec ? STATE.stores.find(s => s.id === rec.storeId) : null;
            const diffMin = computeUnderOverMinutes(rec, store);
            if (diffMin != null) {
                if (diffMin < 0) totalUnderMin += -diffMin;
                else totalOverMin += diffMin;
            }
        } else {
            status = 'absent'; absent++;
        }

        rows.push({ date: ds, status, rec: isPunchRejected(rec) ? null : rec });
    }
    return { present, late, absent, leave, totalUnderMin, totalOverMin, rows };
}

function showToast(msg) {
    STATE.toast = msg; render();
    setTimeout(() => { STATE.toast = null; render(); }, 2800);
}

/* Auth functions */
async function login(email, password) {
    const u = await loginRequest(email, password); // server verifies, no password returned
    if (!u) return false;
    STATE.user = u;
    STATE.page = 'dashboard'; STATE.navOpen = false;
    STATE.reportFilterStoreIds = [];
    STATE.reportFilterStaffIds = [];
    STATE.activeDropdown = null;
    await saveKey('session', u.id, false);
    return true;
}

async function logout() {
    STATE.user = null;
    STATE.reportFilterStoreIds = [];
    STATE.reportFilterStaffIds = [];
    STATE.activeDropdown = null;
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
    <!-- Responsive Background Overlay Clicker -->
    <div class="sidebar-overlay ${STATE.navOpen ? 'visible' : ''}" id="sidebarOverlay"></div>

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
        <div style="display:flex; align-items:center; gap:12px;">
          <!-- Hamburger Button Visible on Mobile -->
          <button class="menu-toggle" id="menuToggleBtn">☰</button>
          <div>
            <h1>${pageTitle(STATE.page)}</h1>
            <div class="ctx">${pageSubtitle(u)}</div>
          </div>
        </div>
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
    let punchStoreSel = document.getElementById('punchStore');
    if (punchStoreSel) {
        punchStoreSel.addEventListener('change', () => {
            STATE.punchStoreId = punchStoreSel.value || null;
            render();
        });
    }

    // Shift radio buttons: no default is pre-selected, user must explicitly choose one
    document.querySelectorAll('input[name="punchShift"]').forEach(radio => {
                radio.addEventListener('change', () => {
                        STATE.punchShift = parseInt(radio.value, 10) === 2 ? 2 : 1;
                    });
            });
    document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', () => { STATE.page = el.dataset.page; STATE.punchStatus = ''; STATE.punchOk = null; render(); }));
    const menuToggleBtn = document.getElementById('menuToggleBtn');
    if (menuToggleBtn) {
        menuToggleBtn.addEventListener('click', () => {
            STATE.navOpen = !STATE.navOpen;
            render();
        });
    }

    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            STATE.navOpen = false;
            render();
        });
    }

    // Modified Nav-Item Event: Added automatic drawer closing for small screens
    document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', () => {
        STATE.page = el.dataset.page;
        STATE.punchStatus = '';
        STATE.punchOk = null;
        STATE.navOpen = false; // 🍏 Auto-closes menu when user taps an items on phone
        render();
    }));
    const logoutBtn = document.getElementById('logoutBtn'); if (logoutBtn) logoutBtn.addEventListener('click', logout);
    const punchInBtn = document.getElementById('punchInBtn'); if (punchInBtn) punchInBtn.addEventListener('click', handlePunchIn);
    const punchOutBtn = document.getElementById('punchOutBtn'); if (punchOutBtn) punchOutBtn.addEventListener('click', handlePunchOut);
    const manualPunchBtn = document.getElementById('manualPunchBtn');
    if (manualPunchBtn) manualPunchBtn.addEventListener('click', async () => {
        const u = STATE.user;

        // Store validation — same message pattern as handlePunchIn
        const storeSel = document.getElementById('punchStore');
        const storeId = u.storeId || (storeSel ? storeSel.value : STATE.punchStoreId);
        const store = STATE.stores.find(s => s.id === storeId);
        if (!store) {
            STATE.punchStatus = u.storeId ? 'No store assigned.' : 'Select a store to punch in.';
            STATE.punchOk = false;
            render();
            return;
        }

        // Shift validation — identical message to handlePunchIn
        const shiftNumber = STATE.punchShift === 2 ? 2 : (STATE.punchShift === 1 ? 1 : null);
        if (!shiftNumber) {
            STATE.punchStatus = 'Please select a shift before punching in.';
            STATE.punchOk = false;
            render();
            return;
        }

        // Geolocation — same "Getting location…" state as regular punch-in
        STATE.punchStatus = 'Getting location…'; STATE.punchOk = null; render();

        try {
            const pos = await geoOnce();
            const { latitude, longitude, accuracy } = pos.coords;
            const loc = { lat: latitude, lng: longitude, accuracy: Math.round(accuracy) };
            STATE.punchStatus = ''; STATE.punchOk = null; render();
            manualPunchModal(render, showToast, uid, loc, storeId, shiftNumber);
        } catch (err) {
            STATE.punchStatus = 'Location error: ' + (err.message || 'denied.');
            STATE.punchOk = false;
            render();
        }
    });

    punchStoreSel = document.getElementById('punchStore'); if (punchStoreSel) punchStoreSel.addEventListener('change', () => { STATE.punchStoreId = punchStoreSel.value; });

    document.querySelectorAll('[data-punch-approve]').forEach(el => el.addEventListener('click', async () => {
        const rec = STATE.attendance.find(a => a.id === el.dataset.punchApprove); if (!rec) return;
        rec.approvalStatus = 'approved'; rec.decidedBy = STATE.user.id; rec.decidedAt = new Date().toISOString();
        await persistAttendance(); showToast('Manual punch-in approved.'); render();
    }));

    document.querySelectorAll('[data-punch-reject]').forEach(el => el.addEventListener('click', async () => {
        const rec = STATE.attendance.find(a => a.id === el.dataset.punchReject); if (!rec) return;
        rec.approvalStatus = 'rejected'; rec.decidedBy = STATE.user.id; rec.decidedAt = new Date().toISOString();
        await persistAttendance(); showToast('Manual punch-in rejected.'); render();
    }));

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

    const addEmpBtn = document.getElementById('addEmployeeBtn');
    if (addEmpBtn) addEmpBtn.addEventListener('click', () => addEmployeeModal(render, showToast, uid));

    const addStoreBtn = document.getElementById('addStoreBtn');
    if (addStoreBtn) addStoreBtn.addEventListener('click', () => addStoreModal(render, showToast, uid, geoOnce));

    const btnCreateTask = document.getElementById('btnCreateTask');
    if (btnCreateTask) {
        btnCreateTask.addEventListener('click', () =>
            createTaskModal(render, showToast, uid, persistTemplates, ensureInstancesForDate, todayStr)
        );
    }

    document.querySelectorAll('[data-edituser]').forEach(el => {
        el.addEventListener('click', () => {
            if (!STATE.user || STATE.user.role !== 'admin') return;
            editEmployeeModal(el.dataset.edituser, render, showToast);
        });
    });

    document.querySelectorAll('[data-editstore]').forEach(el => {
        el.addEventListener('click', () => {
            if (!STATE.user || STATE.user.role !== 'admin') return;
            editStoreModal(el.dataset.editstore, render, showToast, geoOnce);
        });
    });

    // document.querySelectorAll('[data-toggleactive]').forEach(el => el.addEventListener('click', async () => {
    //     const u = STATE.users.find(x => x.id === el.dataset.toggleactive); u.active = u.active === false;
    //     await persistUsers(); render();
    // }));

    // Toggle dropdowns on click
    document.querySelectorAll('[data-dropdown-toggle]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdownType = el.dataset.dropdownToggle; // 'store' or 'staff'
            if (STATE.activeDropdown === dropdownType) {
                STATE.activeDropdown = null;
            } else {
                STATE.activeDropdown = dropdownType;
            }
            render();
        });
    });

    // Handle store checkbox click
    document.querySelectorAll('.report-store-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            if (!STATE.reportFilterStoreIds) STATE.reportFilterStoreIds = [];
            const val = cb.value;
            if (cb.checked) {
                if (!STATE.reportFilterStoreIds.includes(val)) {
                    STATE.reportFilterStoreIds.push(val);
                }
            } else {
                STATE.reportFilterStoreIds = STATE.reportFilterStoreIds.filter(id => id !== val);
            }
            // Trigger cascading clean up for staff who are no longer in scope
            const u = STATE.user;
            const allStaff = employeesForUser(u).filter(x => x.role === 'sales_staff' || x.role === 'store_manager');
            const selectedStoreIds = STATE.reportFilterStoreIds;
            const filteredStaffByStore = selectedStoreIds.length > 0
                ? allStaff.filter(s => selectedStoreIds.includes(s.storeId))
                : allStaff;
            const validStaffIds = new Set(filteredStaffByStore.map(s => s.id));
            if (STATE.reportFilterStaffIds) {
                STATE.reportFilterStaffIds = STATE.reportFilterStaffIds.filter(sid => validStaffIds.has(sid));
            }

            render();
        });
    });

    // Handle staff checkbox click
    document.querySelectorAll('.report-staff-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            if (!STATE.reportFilterStaffIds) STATE.reportFilterStaffIds = [];
            const val = cb.value;
            if (cb.checked) {
                if (!STATE.reportFilterStaffIds.includes(val)) {
                    STATE.reportFilterStaffIds.push(val);
                }
            } else {
                STATE.reportFilterStaffIds = STATE.reportFilterStaffIds.filter(id => id !== val);
            }
            render();
        });
    });

    // Attendance filters
    document.querySelectorAll('.att-store-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            if (!STATE.attendanceFilterStoreIds) STATE.attendanceFilterStoreIds = [];
            const val = cb.value;
            if (cb.checked) {
                if (!STATE.attendanceFilterStoreIds.includes(val)) STATE.attendanceFilterStoreIds.push(val);
            } else {
                STATE.attendanceFilterStoreIds = STATE.attendanceFilterStoreIds.filter(id => id !== val);
            }
            render();
        });
    });
    document.querySelectorAll('.att-staff-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            if (!STATE.attendanceFilterStaffIds) STATE.attendanceFilterStaffIds = [];
            const val = cb.value;
            if (cb.checked) {
                if (!STATE.attendanceFilterStaffIds.includes(val)) STATE.attendanceFilterStaffIds.push(val);
            } else {
                STATE.attendanceFilterStaffIds = STATE.attendanceFilterStaffIds.filter(id => id !== val);
            }
            render();
        });
    });

// Team filters
    document.querySelectorAll('.team-store-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            if (!STATE.teamFilterStoreIds) STATE.teamFilterStoreIds = [];
            const val = cb.value;
            if (cb.checked) {
                if (!STATE.teamFilterStoreIds.includes(val)) STATE.teamFilterStoreIds.push(val);
            } else {
                STATE.teamFilterStoreIds = STATE.teamFilterStoreIds.filter(id => id !== val);
            }
            render();
        });
    });
    document.querySelectorAll('.team-staff-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            if (!STATE.teamFilterStaffIds) STATE.teamFilterStaffIds = [];
            const val = cb.value;
            if (cb.checked) {
                if (!STATE.teamFilterStaffIds.includes(val)) STATE.teamFilterStaffIds.push(val);
            } else {
                STATE.teamFilterStaffIds = STATE.teamFilterStaffIds.filter(id => id !== val);
            }
            render();
        });
    });

    if (document.getElementById('liveClock')) tickClock();
}

async function handlePunchIn() {
    const u = STATE.user;
    const existing = todayRecordFor(u.id);
    // Punch-in is allowed only once per day. A pending manual request or an already-recorded
    // punch-in blocks a fresh one; a previously rejected request can be replaced.
    if (isPunchPending(existing)) { STATE.punchStatus = 'A manual punch-in is awaiting approval.'; STATE.punchOk = false; render(); return; }
    if (isPunchCountable(existing)) { STATE.punchStatus = 'You have already punched in today.'; STATE.punchOk = false; render(); return; }
    // Store is fixed for single-store staff/managers; area managers pick it from the widget.
    const sel = document.getElementById('punchStore');
    const storeId = sel ? sel.value : u.storeId;
    const store = STATE.stores.find(s => s.id === storeId);
    if (!store) { STATE.punchStatus = u.storeId ? 'No store assigned.' : 'Select a store to punch in.'; STATE.punchOk = false; render(); return; }
    // No default shift is pre-selected — the user must explicitly pick Shift 1 or Shift 2.
    const shiftNumber = STATE.punchShift === 2 ? 2 : (STATE.punchShift === 1 ? 1 : null);
    if (!shiftNumber) { STATE.punchStatus = 'Please select a shift before punching in.'; STATE.punchOk = false; render(); return; }
    STATE.punchStatus = 'Getting location…'; STATE.punchOk = null; render();
    try {
        const pos = await geoOnce(); const { latitude, longitude, accuracy } = pos.coords;
        const dist = distanceMeters(latitude, longitude, store.lat, store.lng);
        if (dist > RADIUS_M) { STATE.punchStatus = `You're ${Math.round(dist)}m away.`; STATE.punchOk = false; render(); return; }
        const now = new Date(), date = localDateStr(now);
        // Clear any rejected request for today so it doesn't linger alongside the real punch.
        STATE.attendance = STATE.attendance.filter(a => !(a.userId === u.id && a.date === date && a.approvalStatus === 'rejected'));
        const shiftNumber = STATE.punchShift;
        STATE.attendance.push({ id: uid(), userId: u.id, storeId: store.id, date, checkInTime: now.toISOString(), checkInLoc: { lat: latitude, lng: longitude, accuracy: Math.round(accuracy) }, checkOutTime: null, checkOutLoc: null, checkOutHistory: [], shift: shiftNumber, late: isLateAt(now, store, shiftNumber)  });
        await persistAttendance(); STATE.punchStatus = `Punched in successfully.`; STATE.punchOk = true; STATE.punchShift = null; render();
    } catch(err) { STATE.punchStatus = 'Location error: ' + (err.message || 'denied.'); STATE.punchOk = false; render(); }
}

async function handlePunchOut() {
    const u = STATE.user, rec = todayRecordFor(u.id);
    // Punch-out can be repeated any number of times; the latest one is the record of truth.
    // Blocked only if there is no valid (approved/normal) check-in to close.
    if (!isPunchCountable(rec)) return;
    // Geofence the punch-out against the same store the user checked in at.
    const store = STATE.stores.find(s => s.id === rec.storeId);
    if (!store) { STATE.punchStatus = 'Store for today\'s punch not found.'; STATE.punchOk = false; render(); return; }
    STATE.punchStatus = 'Getting location…'; STATE.punchOk = null; render();
    try {
        const pos = await geoOnce(); const { latitude, longitude, accuracy } = pos.coords;
        const dist = distanceMeters(latitude, longitude, store.lat, store.lng);
        if (dist > RADIUS_M) { STATE.punchStatus = `You're ${Math.round(dist)}m away.`; STATE.punchOk = false; render(); return; }
        const now = new Date(), loc = { lat: latitude, lng: longitude, accuracy: Math.round(accuracy) };
        const isUpdate = !!rec.checkOutTime;
        rec.checkOutTime = now.toISOString(); rec.checkOutLoc = loc;
        if (!Array.isArray(rec.checkOutHistory)) rec.checkOutHistory = [];
        rec.checkOutHistory.push({ time: rec.checkOutTime, loc });
        await persistAttendance(); STATE.punchStatus = isUpdate ? `Punch-out updated (last out kept).` : `Punched out successfully.`; STATE.punchOk = true; render();
    } catch(err) { STATE.punchStatus = 'Location error: ' + (err.message || 'denied.'); STATE.punchOk = false; render(); }
}

let clockInterval = null;
function tickClock() {
    if (clockInterval) clearInterval(clockInterval);
    const update = () => { const el = document.getElementById('liveClock'); if (el) el.textContent = new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
    update(); clockInterval = setInterval(update, 1000);
}

document.addEventListener('click', (e) => {
    if (STATE.activeDropdown && !e.target.closest('.multiselect-dropdown')) {
        STATE.activeDropdown = null;
        render();
    }
});

/* System Bootstrapper Init Engine */
async function init() {
    let [stores, users, taskTemplates, attendance, taskInstances, leaves] = await Promise.all([
        loadKey('stores', true), loadUsersSafe(), loadKey('task_templates', true),
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
    // Materialize today's checklist from active templates so staff/managers actually see tasks to tick off.
    ensureInstancesForDate(STATE.stores.map(s => s.id), todayStr());
    const sessionId = await loadKey('session', false);
    if (sessionId) { const u = STATE.users.find(x => x.id === sessionId); if (u) STATE.user = u; }
    STATE.ready = true;
    render();
}

init();