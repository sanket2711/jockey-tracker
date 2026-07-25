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

    // Remove any existing toast
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

/* Auth functions */
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

/* Master Engine Orchestrator Lifecycle */
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
        case 'roster': return renderDutyRosterPage();
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
        const shiftNumber = STATE.punchShift === 2 ? 2 : (STATE.punchShift === 1 ? 1 : null);
        if (!shiftNumber) { STATE.punchStatus = 'Please select a shift before punching in.'; STATE.punchOk = false; render(); return; }

        manualPunchBtn.disabled = true;
        const originalText = manualPunchBtn.textContent;
        manualPunchBtn.textContent = 'Checking location…';
        STATE.punchStatus = 'Getting location…'; STATE.punchOk = null; render();

        try {
            const pos = await geoOnce();
            const { latitude, longitude, accuracy } = pos.coords;
            const result = nearestStore(latitude, longitude);
            if (!result) { STATE.punchStatus = 'No stores configured.'; STATE.punchOk = false; render(); return; }
            const loc = { lat: latitude, lng: longitude, accuracy: Math.round(accuracy) };
            STATE.punchStatus = ''; STATE.punchOk = null; render();
            manualPunchModal(render, showToast, uid, loc, result.store.id, shiftNumber, u.storeId || null);
        } catch (err) {
            STATE.punchStatus = 'Location error: ' + (err.message || 'denied.');
            STATE.punchOk = false;
            render();
        } finally {
            manualPunchBtn.disabled = false;
            manualPunchBtn.textContent = originalText;
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

    document.querySelectorAll('[data-roster-week]').forEach(el => el.addEventListener('click', () => {
        STATE.rosterWeekOffset = (STATE.rosterWeekOffset || 0) + parseInt(el.dataset.rosterWeek, 10);
        render();
    }));

    document.querySelectorAll('[data-roster-edit]').forEach(el => el.addEventListener('click', () => { STATE.rosterEditingId = el.dataset.rosterEdit; render(); }));
    document.querySelectorAll('[data-roster-cancel-edit]').forEach(el => el.addEventListener('click', () => { STATE.rosterEditingId = null; render(); }));
    document.querySelectorAll('[data-am-roster-edit]').forEach(el => el.addEventListener('click', () => { STATE.rosterEditingId = el.dataset.amRosterEdit; render(); }));
    document.querySelectorAll('[data-am-roster-cancel-edit]').forEach(el => el.addEventListener('click', () => { STATE.rosterEditingId = null; render(); }));

    document.querySelectorAll('.am-roster-form').forEach(form => form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = form.dataset.amUser, weekStart = form.dataset.weekStart, existingId = form.dataset.rosterId;
        const days = {};
        DAY_KEYS.forEach(dk => {
            const typeSel = form.querySelector(`.am-roster-type-select[data-day="${dk}"]`); // CHANGED: correct class name
            const storeSel = form.querySelector(`.am-roster-store-select[data-day="${dk}"]`); // NEW: capture the store too
            const type = typeSel ? typeSel.value : '';
            const needsStore = ['shift1', 'shift2', 'half_day'].includes(type);
            days[dk] = { type, storeId: needsStore ? (storeSel ? storeSel.value : '') : '' }; // CHANGED: match the {type, storeId} shape renderAmRosterTable/amVisitsForStore expect
        });
        const incomplete = DAY_KEYS.some(dk => !days[dk].type || (['shift1','shift2','half_day'].includes(days[dk].type) && !days[dk].storeId)); // CHANGED
        if (incomplete) { showToast('Please assign a store or Off for every day.'); return; } // CHANGED: consistent with the rest of the app

        const now = new Date().toISOString();
        if (existingId) {
            const rec = STATE.dutyRosters.find(r => r.id === existingId);
            rec.days = days; rec.status = 'pending_approval';
            rec.submittedBy = STATE.user.id; rec.submittedAt = now; // CHANGED: resubmission should re-stamp submittedBy like the store roster does
            rec.editedBy = null; rec.editedAt = null; rec.decidedBy = null; rec.decidedAt = null; rec.rejectionReason = null; // CHANGED: field names aligned with store roster
        } else {
            STATE.dutyRosters.push({
                id: uid(), type: 'am', userId, weekStart, days,
                status: 'pending_approval', submittedBy: STATE.user.id, submittedAt: now,
                editedBy: null, editedAt: null, decidedBy: null, decidedAt: null, rejectionReason: null
            });
        }
        STATE.rosterEditingId = null;
        await persistDutyRosters();
        showToast(existingId ? 'Visit plan corrections saved. Approval required again.' : 'Visit plan submitted for approval.');
        render();
    }));

    document.querySelectorAll('[data-roster-save-draft]').forEach(btn => btn.addEventListener('click', async () => {
        const form = btn.closest('.roster-form');
        if (saveStoreRoster(form, { asDraft: true })) {
            await persistDutyRosters();
            showToast('Draft saved. You can continue editing anytime.');
            render();
        }
    }));

    document.querySelectorAll('.roster-form').forEach(form => form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (saveStoreRoster(form, { asDraft: false })) {
            STATE.rosterEditingId = null;
            await persistDutyRosters();
            showToast('Roster submitted for approval.');
            render();
        }
    }));

    document.querySelectorAll('[data-roster-delete-draft]').forEach(el => el.addEventListener('click', async () => {
        const id = el.dataset.rosterDeleteDraft;
        if (!confirm('Delete this draft? All unsaved progress for this week will be lost.')) return;
        STATE.dutyRosters = STATE.dutyRosters.filter(r => r.id !== id);
        await persistDutyRosters();
        showToast('Draft deleted.');
        render();
    }));

    document.querySelectorAll('[data-am-roster-delete-draft]').forEach(el => el.addEventListener('click', async () => {
        const id = el.dataset.amRosterDeleteDraft;
        if (!confirm('Delete this draft visit plan? All unsaved progress for this week will be lost.')) return;
        STATE.dutyRosters = STATE.dutyRosters.filter(r => r.id !== id);
        await persistDutyRosters();
        showToast('Draft visit plan deleted.');
        render();
    }));

    document.querySelectorAll('[data-am-roster-save-draft]').forEach(btn => btn.addEventListener('click', async () => {
        const form = btn.closest('.am-roster-form');
        const userId = form.dataset.amUser, weekStart = form.dataset.weekStart, existingId = form.dataset.rosterId;
        const days = {};
        DAY_KEYS.forEach(dk => {
            const typeSel = form.querySelector(`.am-roster-type-select[data-day="${dk}"]`);
            const storeSel = form.querySelector(`.am-roster-store-select[data-day="${dk}"]`);
            const type = typeSel ? typeSel.value : '';
            const needsStore = ['shift1', 'shift2', 'half_day'].includes(type);
            days[dk] = { type, storeId: needsStore ? (storeSel ? storeSel.value : '') : '' };
        });
        const now = new Date().toISOString();
        if (existingId) {
            const rec = STATE.dutyRosters.find(r => r.id === existingId);
            rec.days = days; rec.status = 'draft';
        } else {
            STATE.dutyRosters.push({
                id: uid(), type: 'am', userId, weekStart, days,
                status: 'draft', submittedBy: null, submittedAt: null,
                editedBy: null, editedAt: null, decidedBy: null, decidedAt: null, rejectionReason: null
            });
        }
        await persistDutyRosters();
        showToast('Draft saved. You can continue editing anytime.');
        render();
    }));

    document.querySelectorAll('[data-roster-approve]').forEach(el => el.addEventListener('click', async () => {
        const rec = STATE.dutyRosters.find(r => r.id === el.dataset.rosterApprove); if (!rec) return;
        rec.status = 'approved'; rec.decidedBy = STATE.user.id; rec.decidedAt = new Date().toISOString(); // CHANGED: decidedBy not approvedBy
        rec.rejectionReason = null; // CHANGED: clear any stale reason once approved
        await persistDutyRosters(); showToast('Roster approved.'); render();
    }));

    document.querySelectorAll('[data-roster-reject]').forEach(el => el.addEventListener('click', () => {
        openRejectReasonModal(el.dataset.rosterReject, 'store');
    }));

    document.querySelectorAll('[data-am-roster-approve]').forEach(el => el.addEventListener('click', async () => {
        const rec = STATE.dutyRosters.find(r => r.id === el.dataset.amRosterApprove); if (!rec) return;
        rec.status = 'approved'; rec.decidedBy = STATE.user.id; rec.decidedAt = new Date().toISOString(); // CHANGED
        rec.rejectionReason = null; // CHANGED
        await persistDutyRosters(); showToast('Visit plan approved.'); render();
    }));

    document.querySelectorAll('[data-am-roster-reject]').forEach(el => el.addEventListener('click', () => { // CHANGED
        openRejectReasonModal(el.dataset.amRosterReject, 'am');
    }));

    bindRosterExclusiveUI();
    bindRosterExportActions();
    bindRosterBulkExport();

    if (document.getElementById('liveClock')) tickClock();
}

async function handlePunchIn() {
    const u = STATE.user;
    const existing = todayRecordFor(u.id);
    if (isPunchPending(existing)) { STATE.punchStatus = 'A punch-in is awaiting approval.'; STATE.punchOk = false; render(); return; }
    if (isPunchCountable(existing)) { STATE.punchStatus = 'You have already punched in today.'; STATE.punchOk = false; render(); return; }

    const shiftNumber = STATE.punchShift === 2 ? 2 : (STATE.punchShift === 1 ? 1 : null);
    if (!shiftNumber) { STATE.punchStatus = 'Please select a shift before punching in.'; STATE.punchOk = false; render(); return; }

    STATE.punchStatus = 'Getting location…'; STATE.punchOk = null; render();
    try {
        const pos = await geoOnce();
        const { latitude, longitude, accuracy } = pos.coords;

        const result = nearestStore(latitude, longitude);
        if (!result) { STATE.punchStatus = 'No stores configured.'; STATE.punchOk = false; render(); return; }
        const { store: nearest, distance } = result;
        if (distance > RADIUS_M) {
            STATE.punchStatus = `You're ${Math.round(distance)}m from the nearest store (${nearest.name}).`;
            STATE.punchOk = false; render(); return;
        }

        const authorizedIds = authorizedStoreIdsFor(u);
        const isAuthorized = authorizedIds.includes(nearest.id);

        const now = new Date(), date = localDateStr(now);
        STATE.attendance = STATE.attendance.filter(a => !(a.userId === u.id && a.date === date && a.approvalStatus === 'rejected'));

        const record = {
            id: uid(), userId: u.id,
            storeId: nearest.id,                  // where they actually punched in
            homeStoreId: u.storeId || null,        // their assigned store (null for area managers)
            date, checkInTime: now.toISOString(),
            checkInLoc: { lat: latitude, lng: longitude, accuracy: Math.round(accuracy) },
            checkOutTime: null, checkOutLoc: null, checkOutHistory: [],
            shift: shiftNumber, late: isLateAt(now, nearest, shiftNumber)
        };

        if (isAuthorized) {
            STATE.attendance.push(record);
            STATE.punchStatus = `Punched in at ${nearest.name}.`;
            STATE.punchOk = true;
        } else {
            record.approvalStatus = 'pending';
            record.autoRouted = true;
            record.requestedAt = now.toISOString();
            record.decidedBy = null;
            record.decidedAt = null;
            STATE.attendance.push(record);
            STATE.punchStatus = `You're at ${nearest.name} — outside your assigned store. Sent for manager approval.`;
            STATE.punchOk = null;
        }

        await persistAttendance();
        STATE.punchShift = null;
        render();
    } catch (err) {
        STATE.punchStatus = 'Location error: ' + (err.message || 'denied.');
        STATE.punchOk = false;
        render();
    }
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

async function handleForcePasswordChange(e) {
    e.preventDefault();
    const u = STATE.user;
    const newPass = document.getElementById('newPasswordInput').value;
    const confirmPass = document.getElementById('confirmPasswordInput').value;
    const errorEl = document.getElementById('forcePassError');

    if (!newPass || newPass.length < 6) {
        if (errorEl) errorEl.textContent = 'Password must be at least 6 characters.';
        return;
    }
    if (newPass !== confirmPass) {
        if (errorEl) errorEl.textContent = 'Passwords do not match.';
        return;
    }

    const target = STATE.users.find(x => x.id === u.id);
    if (target) {
        target.password = newPass;
        target.mustChangePassword = false;
    }
    u.mustChangePassword = false; // keep in-memory session user in sync

    await persistUsers();
    STATE.page = 'dashboard';
    showToast('Password updated successfully.');
    render();
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
    let [stores, users, taskTemplates, attendance, taskInstances, leaves, dutyRosters] = await Promise.all([
        loadKey('stores', true), loadUsersSafe(), loadKey('task_templates', true),
        loadKey('attendance', true), loadKey('task_instances', true), loadKey('leaves', true),
        loadKey('duty_rosters', true)
    ]);
    if (!stores || !users) {
        const seed = seedData();
        stores = seed.stores; users = seed.users; taskTemplates = seed.taskTemplates;
        attendance = []; taskInstances = []; leaves = []; dutyRosters = [];
        await Promise.all([saveKey('stores', stores, true), saveKey('users', users, true), saveKey('task_templates', taskTemplates, true), saveKey('attendance', attendance, true), saveKey('task_instances', taskInstances, true), saveKey('leaves', leaves, true), saveKey('duty_rosters', dutyRosters, true)]);
    }
    STATE.stores = stores || []; STATE.users = users || []; STATE.taskTemplates = taskTemplates || [];
    STATE.attendance = attendance || []; STATE.taskInstances = taskInstances || []; STATE.leaves = leaves || [];
    STATE.dutyRosters = dutyRosters || []; // NEW
    ensureInstancesForDate(STATE.stores.map(s => s.id), todayStr());
    const sessionId = await loadKey('session', false);
    if (sessionId) { const u = STATE.users.find(x => x.id === sessionId); if (u) STATE.user = u; }
    STATE.punchStatus = ''; STATE.punchOk = null;
    STATE.ready = true;
    render();
}

function collectStoreRosterEntries(form, storeId) {
    const staff = activeStaffForStore(storeId);
    const weekStart = form.dataset.weekStart;
    const dates = weekDates(weekStart);

    // Read chips currently in each lane
    // day → userId → type
    const placed = {};
    DAY_KEYS.forEach(dk => { placed[dk] = {}; });

    form.querySelectorAll('[data-roster-chips]').forEach(box => {
        const type = box.dataset.type;
        const dk = box.dataset.day;
        box.querySelectorAll('.roster-chip[data-user]').forEach(chip => {
            placed[dk][chip.dataset.user] = type;
        });
    });

    // Force approved leave
    staff.forEach(s => {
        DAY_KEYS.forEach((dk, i) => {
            if (approvedLeaveForDay(s.id, dates[i])) placed[dk][s.id] = 'leave';
        });
    });

    const crossByDay = {};
    DAY_KEYS.forEach(dk => {
        const storeSel = form.querySelector(`.roster-cross-store-select[data-day="${dk}"]`);
        const shiftSel = form.querySelector(`.roster-cross-shift-select[data-day="${dk}"]`);
        crossByDay[dk] = {
            storeId: storeSel ? storeSel.value : '',
            shiftType: shiftSel ? shiftSel.value : ''
        };
    });

    return staff.map(s => {
        const days = {}, cross = {};
        DAY_KEYS.forEach(dk => {
            days[dk] = placed[dk][s.id] || '';
            if (days[dk] === 'cross_store') cross[dk] = { ...crossByDay[dk] };
        });
        return { userId: s.id, days, cross };
    });
}

function saveStoreRoster(form, { asDraft }) {
    const storeId = form.dataset.store, weekStart = form.dataset.weekStart, existingId = form.dataset.rosterId;
    const entries = collectStoreRosterEntries(form, storeId);
    if (!entries) return false; // conflict toast already shown

    if (!asDraft) {
        const incomplete = entries.some(en => DAY_KEYS.some(dk =>
            !en.days[dk] || (en.days[dk] === 'cross_store' && (!en.cross[dk]?.storeId || !en.cross[dk]?.shiftType))
        ));
        if (incomplete) {
            showToast('Assign every staff member to exactly one duty each day. Cross-store needs store + shift.');
            return false;
        }
    }

    const now = new Date().toISOString();
    if (existingId) {
        const rec = STATE.dutyRosters.find(r => r.id === existingId);
        rec.entries = entries;
        if (asDraft) {
            rec.status = 'draft';
        } else {
            rec.status = 'pending_approval';
            rec.submittedBy = STATE.user.id; rec.submittedAt = now;
            rec.editedBy = null; rec.editedAt = null; rec.decidedBy = null; rec.decidedAt = null;
        }
    } else {
        STATE.dutyRosters.push({
            id: uid(), type: 'store', storeId, weekStart, entries,
            status: asDraft ? 'draft' : 'pending_approval',
            createdBy: STATE.user.id, createdByRole: STATE.user.role, // NEW: track who actually started this roster
            submittedBy: asDraft ? null : STATE.user.id, submittedAt: asDraft ? null : now,
            editedBy: null, editedAt: null, decidedBy: null, decidedAt: null, rejectionReason: null
        });
    }
    return true;
}

function bindRosterExclusiveUI() {
    document.querySelectorAll('.roster-form').forEach(form => {
        if (form.dataset.rosterBound === '1') return; // don't double-bind
        form.dataset.rosterBound = '1';

        const bootEl = form.querySelector('.roster-bootstrap');
        if (!bootEl) return;

        let boot;
        try {
            // textarea → .value (not textContent)
            boot = JSON.parse(bootEl.value || bootEl.textContent || '');
        } catch (err) {
            console.error('roster bootstrap parse failed', err);
            return;
        }
        if (!boot?.staff) return;

        const staffById = Object.fromEntries(boot.staff.map(s => [s.id, s]));

        const closePop = () => {
            document.querySelectorAll('.roster-pop').forEach(p => p.remove());
        };

        const escName = (name) => String(name ?? '').replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
        );

        const chipsHtml = (userId, locked) => {
            const name = staffById[userId]?.name || userId;
            return `<span class="roster-chip${locked ? ' locked' : ''}" data-user="${userId}">
              <span class="chip-name">${escName(name)}</span>
              ${locked ? '' : `<button type="button" class="chip-x" data-roster-chip-remove="${userId}" aria-label="Remove">×</button>`}
            </span>`;
        };

        const refreshUnassigned = (dk) => {
            const taken = new Set();
            form.querySelectorAll(`[data-roster-chips][data-day="${dk}"] .roster-chip[data-user]`)
                .forEach(c => taken.add(c.dataset.user));
            const box = form.querySelector(`[data-roster-unassigned][data-day="${dk}"]`);
            if (!box) return;
            const free = boot.staff.filter(s => !taken.has(s.id));
            box.innerHTML = free.length
                ? free.map(s =>
                    `<span class="roster-chip" data-user="${s.id}"><span class="chip-name">${escName(s.name)}</span></span>`
                ).join('')
                : '<span class="text-faint" style="font-size:11px;">All assigned</span>';
        };

        const removeUserFromDay = (userId, dk) => {
            form.querySelectorAll(
                `[data-roster-chips][data-day="${dk}"] .roster-chip[data-user="${userId}"]`
            ).forEach(ch => ch.remove());
        };

        const addUserToLane = (userId, type, dk) => {
            removeUserFromDay(userId, dk); // exclusive: one duty per day
            const box = form.querySelector(
                `[data-roster-chips][data-type="${type}"][data-day="${dk}"]`
            );
            if (!box) return;
            if (box.querySelector(`.roster-chip[data-user="${userId}"]`)) return;
            box.insertAdjacentHTML('beforeend', chipsHtml(userId, type === 'leave'));
            refreshUnassigned(dk);
        };

        form.addEventListener('click', (e) => {
            const rm = e.target.closest('[data-roster-chip-remove]');
            if (rm) {
                e.preventDefault();
                e.stopPropagation();
                const chip = rm.closest('.roster-chip');
                const lane = rm.closest('[data-roster-chips]');
                if (chip && lane) {
                    const dk = lane.dataset.day;
                    chip.remove();
                    refreshUnassigned(dk);
                }
                closePop();
                return;
            }

            const addBtn = e.target.closest('[data-roster-add]');
            if (!addBtn || !form.contains(addBtn)) return;

            e.preventDefault();
            e.stopPropagation();
            closePop();

            const type = addBtn.dataset.type;
            const dk = addBtn.dataset.day;
            const taken = new Set();
            form.querySelectorAll(`[data-roster-chips][data-day="${dk}"] .roster-chip[data-user]`)
                .forEach(c => taken.add(c.dataset.user));
            const available = boot.staff.filter(s => !taken.has(s.id));

            const pop = document.createElement('div');
            pop.className = 'roster-pop';
            pop.innerHTML =
                `<div class="roster-pop-title">Available · ${String(dk).toUpperCase()}</div>` +
                (available.length
                    ? available.map(s =>
                        `<button type="button" class="roster-pop-item" data-pick="${s.id}">${escName(s.name)}</button>`
                    ).join('')
                    : `<div class="roster-pop-empty">Everyone is already assigned this day</div>`);

            const rect = addBtn.getBoundingClientRect();
            pop.style.position = 'fixed';
            pop.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
            pop.style.top = Math.min(rect.bottom + 6, window.innerHeight - 280) + 'px';
            document.body.appendChild(pop);

            pop.addEventListener('click', (ev) => {
                const item = ev.target.closest('[data-pick]');
                if (!item) return;
                addUserToLane(item.dataset.pick, type, dk);
                closePop();
            });
        });

        DAY_KEYS.forEach(dk => refreshUnassigned(dk));
    });
}

// Call once at module load — NOT inside attachAppEvents on every render
if (!window.__rosterPopCloserBound) {
    window.__rosterPopCloserBound = true;
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.roster-pop') && !e.target.closest('[data-roster-add]')) {
            document.querySelectorAll('.roster-pop').forEach(p => p.remove());
        }
    });
}

function findRosterExportCard(kind, id, week) {
    return document.querySelector(
        `.roster-export-card[data-export-kind="${kind}"][data-export-id="${id}"][data-export-week="${week}"]`
    );
}

function rosterShareFileName(kind, id, week) {
    const label = kind === 'am'
        ? (userName(id) || 'am').replace(/\s+/g, '-')
        : (storeName(id) || 'store').replace(/\s+/g, '-');
    return `duty-roster-${label}-${week}.png`;
}

function rosterShareText(kind, id, week) {
    const range = (() => {
        try {
            const dates = weekDates(week);
            return `${fmtDateShort(dates[0])} – ${fmtDateShort(dates[6])}`;
        } catch {
            return week;
        }
    })();
    if (kind === 'am') {
        return `Duty roster — ${userName(id)} visit plan (${range})`;
    }
    return `Duty roster — ${storeName(id)} (${range})`;
}

async function captureRosterCard(kind, id, week) {
    if (typeof html2canvas !== 'function') {
        showToast('Image export library failed to load. Check your network / CDN.');
        return null;
    }
    const card = findRosterExportCard(kind, id, week);
    if (!card) {
        showToast('Could not find roster to export.');
        return null;
    }
    const target = card.querySelector('.roster-export-target') || card;

    document.body.classList.add('roster-capturing');
    try {
        const canvas = await html2canvas(target, {
            backgroundColor: '#ffffff',
            scale: Math.min(2, window.devicePixelRatio || 2),
            useCORS: true,
            logging: false,
            // Avoid capturing sticky quirks / offscreen overflow poorly
            scrollX: 0,
            scrollY: -window.scrollY
        });
        return canvas;
    } catch (err) {
        console.error(err);
        showToast('Failed to create image.');
        return null;
    } finally {
        document.body.classList.remove('roster-capturing');
    }
}

async function exportRosterImage(kind, id, week) {
    const canvas = await captureRosterCard(kind, id, week);
    if (!canvas) return;
    const blob = await canvasToBlob(canvas);
    if (!blob) { showToast('Could not build PNG.'); return; }
    downloadBlob(blob, rosterShareFileName(kind, id, week));
    showToast('Image downloaded.');
}

async function shareRosterWhatsApp(kind, id, week) {
    const canvas = await captureRosterCard(kind, id, week);
    if (!canvas) return;
    const blob = await canvasToBlob(canvas);
    if (!blob) { showToast('Could not build PNG.'); return; }

    const filename = rosterShareFileName(kind, id, week);
    const text = rosterShareText(kind, id, week);
    const file = new File([blob], filename, { type: 'image/png' });

    // Best path: native share sheet (mobile Chrome/Safari) → user picks WhatsApp
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: 'Duty roster', text });
            showToast('Shared.');
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return; // user cancelled
            console.warn('share failed, falling back', err);
        }
    }

    // Fallback: download image + open WhatsApp with caption (user attaches image manually)
    downloadBlob(blob, filename);
    const waUrl = 'https://wa.me/?text=' + encodeURIComponent(text + '\n\n(Image downloaded — attach it in the chat.)');
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    showToast('Image downloaded. Attach it in WhatsApp.');
}

function bindRosterExportActions() {
    document.querySelectorAll('[data-roster-export-img]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const kind = btn.dataset.rosterExportImg;
            const id = btn.dataset.id;
            const week = btn.dataset.week;
            btn.disabled = true;
            try { await exportRosterImage(kind, id, week); }
            finally { btn.disabled = false; }
        });
    });
    document.querySelectorAll('[data-roster-share-wa]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const kind = btn.dataset.rosterShareWa;
            const id = btn.dataset.id;
            const week = btn.dataset.week;
            btn.disabled = true;
            try { await shareRosterWhatsApp(kind, id, week); }
            finally { btn.disabled = false; }
        });
    });
}


function getStoresBundle(week) {
    return document.querySelector(`.roster-stores-bundle[data-week="${week}"]`)
        || document.querySelector('.roster-stores-bundle');
}

async function captureStoresBundle(week) {
    if (typeof html2canvas !== 'function') {
        showToast('Image export library failed to load.');
        return null;
    }
    const bundle = getStoresBundle(week);
    if (!bundle) {
        showToast('No store rosters on screen to export.');
        return null;
    }
    // Need at least one store card
    if (!bundle.querySelector('.card, .roster-export-card')) {
        showToast('No store rosters to export.');
        return null;
    }

    document.body.classList.add('roster-capturing');
    try {
        // Scroll bundle into view for more reliable capture
        bundle.scrollIntoView({ block: 'nearest' });
        const canvas = await html2canvas(bundle, {
            backgroundColor: '#ffffff',
            scale: Math.min(2, window.devicePixelRatio || 1.5),
            useCORS: true,
            logging: false,
            scrollX: 0,
            scrollY: -window.scrollY,
            windowWidth: document.documentElement.scrollWidth,
            windowHeight: bundle.scrollHeight + 40
        });
        return canvas;
    } catch (err) {
        console.error(err);
        showToast('Failed to create combined image.');
        return null;
    } finally {
        document.body.classList.remove('roster-capturing');
    }
}

function canvasToBlob(canvas) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function allStoresShareName(week) {
    const who = STATE.user?.role === 'admin' ? 'all-stores' : 'my-stores';
    return `duty-rosters-${who}-${week}.png`;
}

function allStoresShareText(week) {
    let range = week;
    try {
        const dates = weekDates(week);
        range = `${dates[0]} – ${dates[6]}`;
    } catch { /* ignore */ }
    const n = document.querySelectorAll('.roster-stores-bundle .card, .roster-stores-bundle .roster-export-card').length;
    const name = STATE.user?.name || 'Area Manager';
    return `Duty rosters (${n} store${n === 1 ? '' : 's'}) — ${name} — week ${range}`;
}

// Helper: returns array of store names whose roster is NOT approved for the week
function unapprovedStoreNames(week) {
    const u = STATE.user;
    const storeIds = u.role === 'admin'
        ? STATE.stores.map(s => s.id)
        : storeIdsForUser(u);

    const unapproved = storeIds.filter(sid => {
        const roster = STATE.dutyRosters.find(r =>
            r.type === 'store' && r.storeId === sid && r.weekStart === week && r.status === 'approved'
        );
        return !roster; // no approved roster = unapproved
    });

    return unapproved.map(sid => {
        const s = STATE.stores.find(x => x.id === sid);
        return s ? s.name : sid;
    });
}

// Also check AM's own roster if user is AM
function amRosterApproved(week) {
    const u = STATE.user;
    if (u.role !== 'area_manager') return true; // N/A for admin
    const amRoster = STATE.dutyRosters.find(r =>
        r.type === 'am' && r.userId === u.id && r.weekStart === week && r.status === 'approved'
    );
    return !!amRoster;
}

async function exportAllStoreRosters(week) {
    const unapproved = unapprovedStoreNames(week);
    if (unapproved.length > 0) {
        showToast(`Please approve duty roster of: ${unapproved.join(', ')}`);
        return;
    }
    if (!amRosterApproved(week)) {
        showToast('Please approve the visit plan for the Area Manager before exporting.');
        return;
    }
    const canvas = await captureStoresBundle(week);
    if (!canvas) return;
    const blob = await canvasToBlob(canvas);
    if (!blob) { showToast('Could not build PNG.'); return; }
    downloadBlob(blob, allStoresShareName(week));
    showToast('Combined roster image downloaded.');
}

async function shareAllStoreRostersWhatsApp(week) {
    const unapproved = unapprovedStoreNames(week);
    if (unapproved.length > 0) {
        showToast(`Please approve duty roster of: ${unapproved.join(', ')}`);
        return;
    }
    if (!amRosterApproved(week)) {
        showToast('Please approve the visit plan for the Area Manager before exporting.');
        return;
    }
    const canvas = await captureStoresBundle(week);
    if (!canvas) return;
    const blob = await canvasToBlob(canvas);
    if (!blob) { showToast('Could not build PNG.'); return; }
    const filename = allStoresShareName(week);
    const text = allStoresShareText(week);
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: 'Duty rosters', text });
            showToast('Shared.');
            return;
        } catch (err) {
            if (err?.name === 'AbortError') return;
            console.warn(err);
        }
    }
    downloadBlob(blob, filename);
    window.open(
        'https://wa.me/?text=' + encodeURIComponent(text + '\n\n(Image downloaded — attach it in the chat.)'),
        '_blank', 'noopener,noreferrer'
    );
    showToast('Image downloaded. Attach it in WhatsApp.');
}

function bindRosterBulkExport() {
    document.querySelectorAll('[data-roster-export-all]').forEach(btn => {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            try { await exportAllStoreRosters(btn.dataset.week); }
            finally { btn.disabled = false; }
        });
    });
    document.querySelectorAll('[data-roster-share-all-wa]').forEach(btn => {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            try { await shareAllStoreRostersWhatsApp(btn.dataset.week); }
            finally { btn.disabled = false; }
        });
    });
}

init();