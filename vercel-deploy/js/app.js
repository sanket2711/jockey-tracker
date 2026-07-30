import { STATE, RADIUS_M } from './config.js';
import {
    uid,
    todayStr,
    localDateStr,
    distanceMeters,
    isLateAt,
    computeUnderOverMinutes,
    DAY_KEYS,
    weekDates, fmtDateShort
} from './helpers.js';
import {
    loadKey, saveKey, seedData, employeesForUser,
    persistInstances, persistTemplates, persistAttendance,
    persistLeaves, persistUsers, loadUsersSafe, loginRequest, nearestStore, authorizedStoreIdsFor,
    persistDutyRosters, activeStaffForStore, approvedLeaveForDay, userName, storeName, storeIdsForUser
} from './services.js';
import {
    renderLogin, navItemsFor, pageTitle, pageSubtitle,
    renderDashboard, renderAttendancePage, renderTasksPage,
    renderLeavePage, renderReportsPage, renderTeamPage, renderStoresPage,
    addEmployeeModal, addStoreModal, manualPunchModal,
    editEmployeeModal, editStoreModal, createTaskModal, renderForcePasswordChange, renderDutyRosterPage,
    openRejectReasonModal, DAY_TYPE_OPTIONS
} from './views.js';

export { todayStr, RADIUS_M };

export function todayRecordFor(userId) {
    return STATE.attendance.find(a => a.userId === userId && a.date === todayStr());
}

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
    const dayOfWeek = d.getDay();
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
            rec.late ? late++ : null;
            present++;

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

export function showToast(msg) {
    STATE.toast = msg;
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
        STATE.toast = null;
        el.remove();
    }, 2800);
}

async function login(email, password) {
    const u = await loginRequest(email, password);
    if (!u) return false;
    STATE.user = u;
    STATE.page = 'dashboard'; STATE.navOpen = false;
    STATE.reportFilterStoreIds = [];
    STATE.reportFilterStaffIds = [];
    STATE.attendanceFilterStoreIds = [];
    STATE.attendanceFilterStaffIds = [];
    STATE.teamFilterStoreIds = [];
    STATE.teamFilterStaffIds = [];
    STATE.activeDropdown = null;
    STATE.punchStatus = '';
    STATE.punchOk = null;
    STATE.punchShift = null;
    STATE.punchStoreId = null;
    STATE.page = u.mustChangePassword ? 'forcePasswordChange' : 'dashboard';
    await saveKey('session', u.id, false);
    return true;
}

async function logout() {
    STATE.user = null;
    STATE.reportFilterStoreIds = [];
    STATE.reportFilterStaffIds = [];
    STATE.attendanceFilterStoreIds = [];
    STATE.attendanceFilterStaffIds = [];
    STATE.teamFilterStoreIds = [];
    STATE.teamFilterStaffIds = [];
    STATE.activeDropdown = null;
    STATE.punchStatus = '';
    STATE.punchOk = null;
    STATE.punchShift = null;
    STATE.punchStoreId = null;
    await saveKey('session', null, false);
    render();
}

export function render() {
    if (document.getElementById('activeModal')) return;
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

    if (STATE.user.mustChangePassword) {
        root.innerHTML = renderForcePasswordChange();
        const form = document.getElementById('forcePasswordForm');
        if (form) form.addEventListener('submit', handleForcePasswordChange);
        return;
    }
}

async function seedMissingSharedData(loaded) {
    const seed = seedData();
    const next = {
        stores: loaded.stores,
        users: loaded.users,
        taskTemplates: loaded.taskTemplates,
        attendance: loaded.attendance,
        taskInstances: loaded.taskInstances,
        leaves: loaded.leaves,
        dutyRosters: loaded.dutyRosters
    };

    const writes = [];

    if (!Array.isArray(next.stores)) {
        next.stores = seed.stores;
        writes.push(saveKey('stores', next.stores, true));
    }
    if (!Array.isArray(next.users)) {
        next.users = seed.users;
        writes.push(saveKey('users', next.users, true));
    }
    if (!Array.isArray(next.taskTemplates)) {
        next.taskTemplates = seed.taskTemplates;
        writes.push(saveKey('task_templates', next.taskTemplates, true));
    }
    if (!Array.isArray(next.attendance)) {
        next.attendance = [];
        writes.push(saveKey('attendance', next.attendance, true));
    }
    if (!Array.isArray(next.taskInstances)) {
        next.taskInstances = [];
        writes.push(saveKey('task_instances', next.taskInstances, true));
    }
    if (!Array.isArray(next.leaves)) {
        next.leaves = [];
        writes.push(saveKey('leaves', next.leaves, true));
    }
    if (!Array.isArray(next.dutyRosters)) {
        next.dutyRosters = [];
        writes.push(saveKey('duty_rosters', next.dutyRosters, true));
    }

    if (writes.length) {
        const results = await Promise.all(writes);
        if (results.some(ok => !ok)) {
            console.warn('Some seed writes failed; data may still be incomplete.');
        }
    }

    return next;
}

async function init() {
    const loaded = {};
    [
        loaded.stores,
        loaded.users,
        loaded.taskTemplates,
        loaded.attendance,
        loaded.taskInstances,
        loaded.leaves,
        loaded.dutyRosters
    ] = await Promise.all([
        loadKey('stores', true),
        loadUsersSafe(),
        loadKey('task_templates', true),
        loadKey('attendance', true),
        loadKey('task_instances', true),
        loadKey('leaves', true),
        loadKey('duty_rosters', true)
    ]);

    const data = await seedMissingSharedData(loaded);

    STATE.stores = data.stores || [];
    STATE.users = data.users || [];
    STATE.taskTemplates = data.taskTemplates || [];
    STATE.attendance = data.attendance || [];
    STATE.taskInstances = data.taskInstances || [];
    STATE.leaves = data.leaves || [];
    STATE.dutyRosters = data.dutyRosters || [];

    ensureInstancesForDate(STATE.stores.map(s => s.id), todayStr());
    const sessionId = await loadKey('session', false);
    if (sessionId) {
        const u = STATE.users.find(x => x.id === sessionId);
        if (u) STATE.user = u;
    }
    STATE.punchStatus = '';
    STATE.punchOk = null;
    STATE.ready = true;
    render();
}

init();
