import {STATE} from './config.js';
import {esc, fmtTime, fmtDate, fmtDateShort, roleLabel} from './helpers.js';
import {storeName, userName, storesForUser, storeIdsForUser, employeesForUser} from './services.js';
import {
    todayStr, RADIUS_M, todayRecordFor, monthlyReport, isPunchPending, isPunchCountable, isPunchRejected
} from './app.js';

export function renderLogin() {
    const demo = [['Admin / Owner', 'sanketbaheti1@gmail.com', 'admin123'], ['Area Manager', 'dinesh.area@sge.demo', 'area123'], ['Store Manager', 'sundar.manager@sge.demo', 'manager123'], ['Sales Staff', 'adarsh@sge.demo', 'staff123'],];
    return `
  <div class="login-wrap">
    <div class="login-card">
      <div class="brand-mark"><div class="brand-clock"></div><div><div class="brand-name">SHIFTLEDGER</div><div class="brand-sub">Store Ops Punch Clock</div></div></div>
      <h1>Sign in</h1>
      <p class="lead">Track attendance, tasks and leave across all your stores.</p>
      <div id="loginError"></div>
      <form id="loginForm">
        <div class="field"><label>Email</label><input type="email" id="loginEmail" required placeholder="you@storeflow.demo"></div>
        <div class="field"><label>Password</label><input type="password" id="loginPassword" required placeholder="••••••••"></div>
        <button class="btn btn-primary btn-block" type="submit">Sign in</button>
      </form>
      <details class="demo-accounts">
        <summary>Demo accounts (tap to autofill)</summary>
        <div class="demo-list">
          ${demo.map(d => `<div class="demo-row" data-email="${esc(d[1])}" data-pass="${esc(d[2])}"><span><b>${esc(d[0])}</b></span><span class="mono">${esc(d[1])}</span></div>`).join('')}
        </div>
      </details>
    </div>
  </div>`;
}

export function navItemsFor(role) {
    const base = [['dashboard', 'Dashboard'], ['attendance', 'Attendance'], ['tasks', 'Tasks'], ['leave', 'Leave']];
    if (role !== 'sales_staff') base.push(['reports', 'Reports']);
    if (role === 'admin') {
        base.push(['team', 'Team']);
        base.push(['stores', 'Stores']);
    }
    return base;
}

export function pageTitle(p) {
    return {
        dashboard: 'Dashboard',
        attendance: 'Attendance',
        tasks: 'Daily Tasks',
        leave: 'Leave',
        reports: 'Reports',
        team: 'Team',
        stores: 'Stores'
    }[p] || '';
}

export function pageSubtitle(u) {
    if (u.role === 'admin') return 'All 4 stores';
    if (u.role === 'area_manager') return storesForUser(u).map(s => s.name).join(' · ');
    return storeName(u.storeId);
}

export function renderPunchWidget() {
    const u = STATE.user;
    const rec = todayRecordFor(u.id);
    // Stores this user can punch against: single-store staff/managers use their assigned store;
    // area managers choose from the stores they oversee. Anyone else (e.g. owner) gets no widget.
    const punchStores = u.storeId ? STATE.stores.filter(s => s.id === u.storeId) : (u.role === 'area_manager' ? storesForUser(u) : []);
    if (!punchStores.length) return '';
    // Once punched (or pending), the store is locked to that record; otherwise honor the picker.
    const savedId = STATE.punchStoreId && punchStores.some(s => s.id === STATE.punchStoreId) ? STATE.punchStoreId : null;
    const activeStoreId = rec ? rec.storeId : (savedId || punchStores[0].id);
    const store = STATE.stores.find(s => s.id === activeStoreId);
    // Show the picker for store-less users (area managers) until they've punched for the day.
    const showPicker = !rec && !u.storeId;
    const storeLine = showPicker ? `<select class="punch-store-select" id="punchStore">${punchStores.map(s => `<option value="${s.id}" ${s.id === activeStoreId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
       <div class="punch-store">within ${RADIUS_M}m of the selected store</div>` : `<div class="punch-store">${store ? esc(store.name) + ' · within ' + RADIUS_M + 'm required' : 'No store assigned'}</div>`;
    const now = new Date();
    let shiftSelectorHtml = '';
    if (!rec && store) {
        const s1 = `${store.shift1Start || '—'} – ${store.shift1End || '—'}`;
        const s2 = `${store.shift2Start || '—'} – ${store.shift2End || '—'}`;
        shiftSelectorHtml = `
       <div class="punch-shift-row">
       <div class="punch-shift-label">Shift</div>
        <div class="punch-shift-radio-group" role="radiogroup" aria-label="Select shift">
                      <label class="punch-shift-radio">
                        <input type="radio" name="punchShift" value="1" ${STATE.punchShift === 1 ? 'checked' : ''}>
                        <span>Shift 1 <small>(${s1})</small></span>
                      </label>
                      <label class="punch-shift-radio">
                        <input type="radio" name="punchShift" value="2" ${STATE.punchShift === 2 ? 'checked' : ''}>
                        <span>Shift 2 <small>(${s2})</small></span>
                      </label>
                    </div>
      </div>`;
    }
    let btnHtml,
        statusColor = STATE.punchOk === false ? 'var(--alert)' : (STATE.punchOk ? 'var(--success)' : 'rgba(255,255,255,0.75)');
    const manualLink = `<button class="punch-link" id="manualPunchBtn">Missed punch-in? Request manual entry</button>`;
    if (isPunchPending(rec)) {
        // Manual punch-in submitted and awaiting a manager's decision.
        btnHtml = `<button class="punch-btn" disabled>Awaiting Approval</button>`;
    } else if (!isPunchCountable(rec)) {
        // No valid check-in yet today (never punched, or previous manual request was rejected).
        btnHtml = `<button class="punch-btn" id="punchInBtn">Punch In</button>${manualLink}`;
    } else if (!rec.checkOutTime) {
        btnHtml = `<button class="punch-btn out" id="punchOutBtn">Punch Out</button>`;
    } else {
        // Already checked out — punch-out stays available so the last one wins.
        btnHtml = `<button class="punch-btn out" id="punchOutBtn">Update Punch Out</button>`;
    }

    const outCount = rec && Array.isArray(rec.checkOutHistory) ? rec.checkOutHistory.length : 0;
    let statusVal = '—';
    if (isPunchPending(rec)) statusVal = '<span class="pill pill-pending">Pending approval</span>'; else if (isPunchRejected(rec)) statusVal = '<span class="pill pill-rejected">Rejected</span>'; else if (isPunchCountable(rec)) statusVal = rec.late ? '<span class="pill pill-late">Late</span>' : '<span class="pill pill-present">On time</span>';

    return `
  <div class="punch-wrap">
    <div class="punch-card">
      <div class="punch-time mono">${now.toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    })}</div>
      <div class="punch-date">${fmtDate(todayStr())}</div>
      ${storeLine}
      ${shiftSelectorHtml}
      ${btnHtml}
      <div class="punch-status" style="color:${statusColor}">${esc(STATE.punchStatus || '')}</div>
    </div>
    <div class="ticket">
      <h3>Today's Punch</h3>
      ${!u.storeId ? `<div class="ticket-row"><span class="lbl">Store</span><span class="val">${store ? esc(store.name) : '—'}</span></div>` : ''}
      <div class="ticket-row"><span class="lbl">Check-in</span><span class="val">${rec && !isPunchRejected(rec) ? fmtTime(rec.checkInTime) + (rec.manual ? ' <span class="pill pill-pending">Manual</span>' : '') : '—'}</span></div>
      <div class="ticket-row"><span class="lbl">Status</span><span class="val">${statusVal}</span></div>
      <div class="ticket-row"><span class="lbl">Check-out</span><span class="val">${isPunchCountable(rec) && rec.checkOutTime ? fmtTime(rec.checkOutTime) + (outCount > 1 ? ` <span class="text-faint">(×${outCount})</span>` : '') : '—'}</span></div>
      <div class="ticket-row"><span class="lbl">Geo-fence</span><span class="val">${RADIUS_M}m radius</span></div>
      ${rec && rec.manual && rec.manualReason ? `<div class="ticket-row"><span class="lbl">Reason</span><span class="val">${esc(rec.manualReason)}</span></div>` : ''}
    </div>
  </div>`;
}

export function renderPunchApprovalTable(list) {
    const rows = list.slice().sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || '')).map(r => `
    <tr><td><b>${esc(userName(r.userId))}</b><div class="badge-role">${esc(storeName(r.storeId))}</div></td>
    <td>${fmtDateShort(r.date)}</td>
    <td>${fmtTime(r.checkInTime)} ${r.late ? '<span class="pill pill-late">Late</span>' : '<span class="pill pill-present">On time</span>'}</td>
    <td>${esc(r.manualReason || '—')}</td>
    <td><button class="btn btn-sm btn-primary" data-punch-approve="${r.id}">Approve</button> <button class="btn btn-sm btn-danger" data-punch-reject="${r.id}">Reject</button></td>
    </tr>`).join('');
    return `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Date</th><th>Claimed check-in</th><th>Reason</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderLeaveTable(list, showActions) {
    const rows = list.slice().sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).map(l => `
    <tr><td><b>${esc(userName(l.userId))}</b><div class="badge-role">${esc(storeName(l.storeId))}</div></td>
    <td>${fmtDateShort(l.fromDate)} – ${fmtDateShort(l.toDate)}</td>
    <td>${esc(l.reason)}</td>
    <td><span class="pill pill-${l.status}">${l.status[0].toUpperCase() + l.status.slice(1)}</span></td>
    <td>${showActions && l.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-approve="${l.id}">Approve</button> <button class="btn btn-sm btn-danger" data-reject="${l.id}">Reject</button>` : ''}</td>
    </tr>`).join('');
    return `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Dates</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderMonthPicker() {
    const label = STATE.month.toLocaleDateString([], {month: 'long', year: 'numeric'});
    return `<div class="section-title">Monthly Report<span class="month-switch"><button data-month="-1">‹</button><span>${label}</span><button data-month="1">›</button></span></div>`;
}

export function renderReportSummary(rep) {
    return `<div class="grid grid-4">
    <div class="card stat-card"><div class="stat-label">Present</div><div class="stat-value" style="color:var(--success)">${rep.present}</div></div>
    <div class="card stat-card"><div class="stat-label">Late</div><div class="stat-value" style="color:var(--amber-dark)">${rep.late}</div></div>
    <div class="card stat-card"><div class="stat-label">Absent</div><div class="stat-value" style="color:var(--alert)">${rep.absent}</div></div>
    <div class="card stat-card"><div class="stat-label">Leave</div><div class="stat-value" style="color:var(--steel)">${rep.leave}</div></div>
  </div>`;
}

export function renderReportRows(rep) {
    const rows = rep.rows.slice().reverse().map(r => `<tr><td>${fmtDate(r.date)}</td><td><span class="pill pill-${r.status}">${r.status[0].toUpperCase() + r.status.slice(1)}</span></td>
    <td>${r.rec ? fmtTime(r.rec.checkInTime) : '—'}</td><td>${r.rec ? fmtTime(r.rec.checkOutTime) : '—'}</td></tr>`).join('');
    return `<div class="table-wrap" style="margin-top:12px;"><table><thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* Page Routers Template Parsers */
export function renderDashboard() {
    const u = STATE.user, ids = storeIdsForUser(u), today = todayStr();
    const canDecide = u.role !== 'sales_staff';
    const scopedStaff = STATE.users.filter(x => ids.includes(x.storeId));
    const scopedStaffIds = new Set(scopedStaff.map(s => s.id));
    // Count only in-scope staff so an area manager's own punch doesn't skew the team percentage.
    const todaysAtt = STATE.attendance.filter(a => scopedStaffIds.has(a.userId) && a.date === today && isPunchCountable(a));
    const presentCount = todaysAtt.length;
    const lateCount = todaysAtt.filter(a => a.late).length;
    const attPct = scopedStaff.length ? Math.round(presentCount / scopedStaff.length * 100) : 0;
    const todaysTasks = STATE.taskInstances.filter(i => ids.includes(i.storeId) && i.date === today);
    const tasksDone = todaysTasks.filter(t => t.completed).length;
    const taskPct = todaysTasks.length ? Math.round(tasksDone / todaysTasks.length * 100) : 0;
    const pendingLeaves = canDecide ? STATE.leaves.filter(l => l.status === 'pending' && l.userId !== u.id && (u.role === 'admin' || ids.includes(l.storeId))) : [];
    const pendingPunches = canDecide ? STATE.attendance.filter(a => ids.includes(a.storeId) && a.approvalStatus === 'pending' && a.userId !== u.id) : [];

    let personalPunch = '';
    const punchWidget = renderPunchWidget();
    if (punchWidget) {
        const hint = u.storeId ? storeName(u.storeId) : 'Select your store';
        personalPunch = `<div class="section-title">Your Punch<span class="hint">Today · ${hint}</span></div>${punchWidget}`;
    }

    const storeRows = storesForUser(u).map(s => {
        const staff = STATE.users.filter(x => x.storeId === s.id);
        const staffIds = new Set(staff.map(x => x.id));
        const att = STATE.attendance.filter(a => a.storeId === s.id && a.date === today && staffIds.has(a.userId) && isPunchCountable(a));
        const pct = staff.length ? Math.round(att.length / staff.length * 100) : 0;
        const tks = STATE.taskInstances.filter(t => t.storeId === s.id && t.date === today);
        const tdone = tks.filter(t => t.completed).length;
        return `<tr><td><b>${esc(s.name)}</b></td><td>${staff.length}</td><td>${att.length}/${staff.length} <span class="text-faint">(${pct}%)</span></td>
      <td>${att.filter(a => a.late).length}</td><td>${tdone}/${tks.length}</td></tr>`;
    }).join('');

    return `
  ${personalPunch}
  <div class="section-title">Overview<span class="hint">${fmtDate(today)}</span></div>
  <div class="grid grid-4">
    <div class="card stat-card"><div class="stat-label">Team</div><div class="stat-value">${scopedStaff.length}</div><div class="stat-note">across ${ids.length} store${ids.length !== 1 ? 's' : ''}</div></div>
    <div class="card stat-card"><div class="stat-label">Present Today</div><div class="stat-value">${attPct}%</div><div class="stat-note">${presentCount} of ${scopedStaff.length} punched in</div></div>
    <div class="card stat-card"><div class="stat-label">Late Today</div><div class="stat-value" style="color:${lateCount ? 'var(--amber-dark)' : 'inherit'}">${lateCount}</div><div class="stat-note">after 9:45am</div></div>
    <div class="card stat-card"><div class="stat-label">Tasks Done</div><div class="stat-value">${taskPct}%</div><div class="stat-note">${tasksDone} of ${todaysTasks.length} today</div></div>
  </div>
  ${storesForUser(u).length > 1 ? `
  <div class="section-title">Stores at a glance</div>
  <div class="table-wrap"><table><thead><tr><th>Store</th><th>Staff</th><th>Present</th><th>Late</th><th>Tasks</th></tr></thead>
  <tbody>${storeRows}</tbody></table></div>` : ''}
  ${canDecide ? `
  <div class="section-title">Pending Punch-In Approvals<span class="hint">${pendingPunches.length}</span></div>
  ${pendingPunches.length ? renderPunchApprovalTable(pendingPunches) : '<div class="empty-note">Nothing pending.</div>'}
  <div class="section-title">Pending Leave Requests<span class="hint">${pendingLeaves.length}</span></div>
  ${pendingLeaves.length ? renderLeaveTable(pendingLeaves, true) : '<div class="empty-note">Nothing pending.</div>'}` : ''}
  `;
}

export function renderAttendancePage() {
    const u = STATE.user, ids = storeIdsForUser(u), today = todayStr();
    let html = '';
    html += renderPunchWidget();
    const staffScope = u.role === 'sales_staff' ? [u] : STATE.users.filter(x => ids.includes(x.storeId) && x.role !== 'admin' && x.role !== 'area_manager');
    const rows = staffScope.map(s => {
        const rec = STATE.attendance.find(a => a.userId === s.id && a.date === today);
        const show = rec && !isPunchRejected(rec);
        let pill = '<span class="pill pill-absent">Absent</span>';
        if (isPunchPending(rec)) pill = '<span class="pill pill-pending">Pending</span>'; else if (isPunchCountable(rec)) pill = rec.late ? '<span class="pill pill-late">Late</span>' : '<span class="pill pill-present">Present</span>';
        return `<tr><td><b>${esc(s.name)}</b><div class="badge-role">${esc(roleLabel(s.role))}</div></td><td>${esc(storeName(s.storeId))}</td>
      <td>${show ? fmtTime(rec.checkInTime) : '—'}</td><td>${show && isPunchCountable(rec) ? fmtTime(rec.checkOutTime) : '—'}</td><td>${pill}</td></tr>`;
    }).join('');
    html += `
  <div class="section-title">${u.role === 'sales_staff' ? 'Your record today' : "Today's Roster"}<span class="hint">${fmtDate(today)}</span></div>
  <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Store</th><th>In</th><th>Out</th><th>Status</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" class="empty-note">No one in scope.</td></tr>'}</tbody></table></div>
  `;
    if (u.role === 'sales_staff') {
        const rep = monthlyReport(u.id, STATE.month);
        html += renderMonthPicker() + renderReportSummary(rep) + renderReportRows(rep);
    }
    return html;
}

export function renderTasksPage() {
    const u = STATE.user, ids = storeIdsForUser(u), today = todayStr();
    const canManage = ['store_manager', 'area_manager', 'admin'].includes(u.role);
    let html = '';

    if (canManage) {
        html += `<div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
            <button class="btn btn-primary" id="btnCreateTask">Create Task</button>
        </div>`;
    }

    storesForUser(u).forEach(s => {
        const tasks = STATE.taskInstances.filter(t => t.storeId === s.id && t.date === today);
        const done = tasks.filter(t => t.completed).length;
        html += `<div class="section-title">${esc(s.name)}<span class="hint">${done}/${tasks.length} complete</span></div>
    <div class="table-wrap"><div class="table-responsive"><table class="table table-hover align-middle mb-0" style="table-layout:fixed;width:100%;"><tbody>${tasks.map(t => {
            let assignBadge = '';
            if (t.assignedTo) {
                const assignee = userName(t.assignedTo);
                const isMe = t.assignedTo === u.id;
                assignBadge = `<span class="badge-role" style="background:var(--canvas);padding:2px 6px;border-radius:4px;margin-left:6px;display:inline-block;${isMe ? 'color:var(--amber);background:rgba(215,25,32,0.1);' : ''}">${esc(assignee)}</span>`;
            }
            return `
      <tr><td style="padding:0;">
      <div class="task-row" style="margin:0;border:none;border-radius:0;border-bottom:1px solid var(--line);">
        <div class="task-check ${t.completed ? 'done' : ''}" data-toggle="${t.id}">${t.completed ? '✓' : ''}</div>
        <div style="flex:1;min-width:0;">
            <div class="task-title ${t.completed ? 'done' : ''}" style="white-space:normal;">${esc(t.title)} ${assignBadge}</div>
            <div class="task-meta">${t.completed ? 'done by ' + esc(userName(t.completedBy)) + ' · ' + fmtTime(t.completedAt) : ''}</div>
        </div>
      </div>
      </td></tr>`;
        }).join('') || '<tr><td class="empty-note">No tasks configured for this store yet.</td></tr>'}
    </tbody></table></div></div>
    ${canManage && (u.role !== 'sales_staff') ? `
      <details style="margin-top:16px;margin-bottom:24px;"><summary class="subtle-link">Manage checklist (${STATE.taskTemplates.filter(t => t.storeId === s.id && t.active).length} active)</summary>
      <div style="margin-top:8px;">
      ${STATE.taskTemplates.filter(t => t.storeId === s.id && t.active).map(t => {
            let recStr = 'Daily';
            if (t.recurrence) {
                if (t.recurrence.type === 'weekly') recStr = 'Weekly';
                if (t.recurrence.type === 'monthly') recStr = 'Monthly (Day ' + t.recurrence.dayOfMonth + ')';
            }
            let assignStr = t.assignedTo ? ' · ' + esc(userName(t.assignedTo)) : ' · Any staff';
            return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--line);font-size:13px;">
          <div><div style="font-weight:500;">${esc(t.title)}</div><div class="task-meta" style="margin-top:4px;">${recStr}${assignStr}</div></div>
          <span class="subtle-link" style="color:var(--alert);padding:8px;cursor:pointer;" data-removetpl="${t.id}">Remove</span>
        </div>`;
        }).join('')}
      </div></details>` : ''}
    `;
    });
    return html || '<div class="empty-note">No stores available.</div>';
}

export function renderLeavePage() {
    const u = STATE.user, ids = storeIdsForUser(u);
    let html = '';
    // Everyone except the owner/admin can request their own leave — staff, store managers and area managers.
    const canRequest = u.role !== 'admin';
    if (canRequest) {
        html += `
    <div class="section-title">Request Leave</div>
    <div class="card">
      <form id="leaveForm">
        <div class="two-col">
          <div class="field"><label>From</label><input type="date" id="leaveFrom" required></div>
          <div class="field"><label>To</label><input type="date" id="leaveTo" required></div>
        </div>
        <div class="field"><label>Reason</label><textarea id="leaveReason" rows="2" placeholder="Brief reason" required></textarea></div>
        <button class="btn btn-primary" type="submit">Submit request</button>
      </form>
    </div>`;
    }

    // Your own requests (never approvable by yourself).
    if (canRequest) {
        const mine = STATE.leaves.filter(l => l.userId === u.id);
        const minePending = mine.filter(l => l.status === 'pending');
        html += `<div class="section-title">Your Requests<span class="hint">${minePending.length} pending</span></div>
  ${mine.length ? renderLeaveTable(mine, false) : '<div class="empty-note">You have no leave requests.</div>'}`;
    }

    // Requests this user can act on. Store-less (area manager) requests route to the owner/admin only.
    const canDecide = u.role === 'store_manager' || u.role === 'area_manager' || u.role === 'admin';
    if (canDecide) {
        const approvals = STATE.leaves.filter(l => l.userId !== u.id && (u.role === 'admin' || ids.includes(l.storeId)));
        const pending = approvals.filter(l => l.status === 'pending');
        const decided = approvals.filter(l => l.status !== 'pending');
        html += `<div class="section-title">Approvals · Pending<span class="hint">${pending.length}</span></div>
  ${pending.length ? renderLeaveTable(pending, true) : '<div class="empty-note">Nothing pending.</div>'}
  <div class="section-title">Approvals · History</div>
  ${decided.length ? renderLeaveTable(decided, false) : '<div class="empty-note">No past decisions.</div>'}`;
    }
    return html;
}

export function renderReportsPage() {
    const u = STATE.user;
    const allStores = storesForUser(u);
    const staff = employeesForUser(u).filter(x => x.role === 'sales_staff' || x.role === 'store_manager');

    // Safe initialization
    if (!STATE.reportFilterStoreIds) STATE.reportFilterStoreIds = [];
    if (!STATE.reportFilterStaffIds) STATE.reportFilterStaffIds = [];

    const selectedStoreIds = STATE.reportFilterStoreIds;

    // Filter staff list to only show staff from selected stores in the dropdown and reports
    const filteredStaffByStore = selectedStoreIds.length > 0 ? staff.filter(s => selectedStoreIds.includes(s.storeId)) : staff;

    // Clean up selected staff if they are no longer in scope due to store filter changes
    const validStaffIds = new Set(filteredStaffByStore.map(s => s.id));
    STATE.reportFilterStaffIds = STATE.reportFilterStaffIds.filter(sid => validStaffIds.has(sid));
    const selectedStaffIds = STATE.reportFilterStaffIds;

    // The staff members whose attendance is to be listed in the table
    const displayStaff = selectedStaffIds.length > 0 ? filteredStaffByStore.filter(s => selectedStaffIds.includes(s.id)) : filteredStaffByStore;

    const summary = displayStaff.map(s => {
        const rep = monthlyReport(s.id, STATE.month);
        const total = rep.present + rep.late + rep.absent + rep.leave;
        // const pct = total ? Math.round((rep.present + rep.late) / total * 100) : 0;

        const netMin = (rep.totalOverMin || 0) - (rep.totalUnderMin || 0);
        const netHours = (netMin / 60).toFixed(1);
        const netLabel = `${netHours} h ${netMin >= 0 ? 'OT' : 'UT'}`;  // OT=over, UT=under

        return `<tr>
      <td>
        <b>${esc(s.name)}</b>
        <div class="badge-role">${esc(roleLabel(s.role))} · ${esc(storeName(s.storeId))}</div>
      </td>
      <td style="color:var(--success)">${rep.present}</td>
      <td style="color:var(--amber-dark)">${rep.late}</td>
      <td style="color:var(--alert)">${rep.absent}</td>
      <td style="color:var(--steel)">${rep.leave}</td>
      <td>${netLabel}</td>
    </tr>`;
    }).join('');

    // Render Store Dropdown
    let storeBtnLabel = "All Stores";
    if (selectedStoreIds.length > 0) {
        storeBtnLabel = selectedStoreIds.map(storeName).filter(Boolean).join(', ');
        if (storeBtnLabel.length > 25) {
            storeBtnLabel = `${selectedStoreIds.length} stores selected`;
        }
    }

    const storeOptions = allStores.map(st => {
        const checked = selectedStoreIds.includes(st.id) ? 'checked' : '';
        return `
        <label class="multiselect-dropdown-item">
            <input type="checkbox" class="report-store-checkbox" value="${st.id}" ${checked}>
            ${esc(st.name)}
        </label>
        `;
    }).join('');

    // Render Staff Dropdown
    let staffBtnLabel = "All Staff";
    if (selectedStaffIds.length > 0) {
        staffBtnLabel = selectedStaffIds.map(sid => {
            const st = staff.find(x => x.id === sid);
            return st ? st.name : '';
        }).filter(Boolean).join(', ');
        if (staffBtnLabel.length > 25) {
            staffBtnLabel = `${selectedStaffIds.length} staff selected`;
        }
    }

    const staffOptions = filteredStaffByStore.map(s => {
        const checked = selectedStaffIds.includes(s.id) ? 'checked' : '';
        return `
        <label class="multiselect-dropdown-item">
            <input type="checkbox" class="report-staff-checkbox" value="${s.id}" ${checked}>
            ${esc(s.name)}
        </label>
        `;
    }).join('');

    return `
  ${renderMonthPicker()}
  <div class="filter-bar">
      <div style="font-size:12px;color:var(--text-soft);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Filter:</div>
      <div class="multiselect-dropdown ${STATE.activeDropdown === 'store' ? 'open' : ''}" id="reportStoreDropdown">
          <div class="multiselect-dropdown-btn" data-dropdown-toggle="store">${esc(storeBtnLabel)}</div>
          <div class="multiselect-dropdown-content">
              ${storeOptions || '<div class="empty-note">No stores available</div>'}
          </div>
      </div>
      <div class="multiselect-dropdown ${STATE.activeDropdown === 'staff' ? 'open' : ''}" id="reportStaffDropdown">
          <div class="multiselect-dropdown-btn" data-dropdown-toggle="staff">${esc(staffBtnLabel)}</div>
          <div class="multiselect-dropdown-content">
              ${staffOptions || '<div class="empty-note">No staff in scope</div>'}
          </div>
      </div>
  </div>
  <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Present</th><th>Late</th><th>Absent</th><th>Leave</th><th>Under/Overtime</th></tr></thead>
  <tbody>${summary || '<tr><td colspan="6" class="empty-note">No staff in scope.</td></tr>'}</tbody></table></div>
  `;
}

export function renderTeamPage() {
    const rows = STATE.users
        .filter(u => u.role !== 'admin')
        .map(u => `
        <tr>
          <td>
            <b>${esc(u.name)}</b>
            <div class="badge-role">${esc(u.email)}</div>
          </td>
          <td>${esc(roleLabel(u.role))}</td>
          <td>${u.role === 'area_manager' ? (u.storeIds || []).map(storeName).join(', ') || '—' : esc(storeName(u.storeId))}</td>
          <td>${u.active === false ? '<span class="pill pill-absent">Inactive</span>' : '<span class="pill pill-present">Active</span>'}</td>
          <td><button class="btn btn-ghost btn-sm btn-block" data-edituser="${u.id}">Edit</button></td>
        </tr>`).join('');

    return `
      <div class="section-title">All Employees<span class="hint">${STATE.users.filter(u => u.role !== 'admin').length} people</span></div>
      <button class="btn btn-amber btn-sm btn-block" id="addEmployeeBtn">+ Add employee</button>
      <div class="table-wrap mobile-table-cards" style="margin-top:14px;">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Store(s)</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
}

export function renderStoresPage() {
    const rows = STATE.stores.map(s => {
        const staff = STATE.users.filter(x => x.storeId === s.id).length;
        const shifts = `S1 ${s.shift1Start || '—'}-${s.shift1End || '—'} · S2 ${s.shift2Start || '—'}-${s.shift2End || '—'}`;

        return `
          <tr>
            <td>
              <b>${esc(s.name)}</b>
              <div class="badge-role">${esc(shifts)}</div>
            </td>
            <td>${esc(s.address || '—')}</td>
            <td class="mono">${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}</td>
            <td>${staff}</td>
            <td><button class="btn btn-ghost btn-sm btn-block" data-editstore="${s.id}">Edit</button></td>
          </tr>`;
    }).join('');

    return `
      <div class="section-title">Stores<span class="hint">${STATE.stores.length}</span></div>
      <button class="btn btn-amber btn-sm btn-block" id="addStoreBtn">+ Add store</button>
      <div class="table-wrap mobile-table-cards" style="margin-top:14px;">
        <table>
          <thead><tr><th>Store</th><th>Address</th><th>Coordinates</th><th>Staff</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--text-faint);margin-top:10px;">
        Coordinates define the center of the ${RADIUS_M}m check-in geofence for each store.
      </p>
    `;
}

/* ---------- Interactive Overlay Modals ---------- */

export function openModal(htmlContent) {
    closeModal();

    const modalBg = document.createElement('div');
    modalBg.className = 'modal-bg';
    modalBg.id = 'activeModal';
    modalBg.innerHTML = `
    <div class="modal">
      ${htmlContent}
    </div>
  `;

    document.body.appendChild(modalBg);

    modalBg.addEventListener('click', (e) => {
        if (e.target === modalBg) closeModal();
    });
}

export function closeModal() {
    const modal = document.getElementById('activeModal');
    if (modal) modal.remove();
}

export function addEmployeeModal(triggerRender, showToast, uidGenerator) {
    const singleStoreOptions = STATE.stores
        .map(s => `<option value="${s.id}">${esc(s.name)}</option>`)
        .join('');

    const multiStoreOptions = STATE.stores
        .map(s => `
          <label class="multi-check-row">
            <input type="checkbox" class="emp-area-store" value="${s.id}">
            <span>${esc(s.name)}</span>
          </label>
        `).join('');

    const content = `
      <div class="modal-head">
        <h3>Add Employee</h3>
        <button type="button" class="icon-close" id="closeModalBtn" aria-label="Close">✕</button>
      </div>

      <form id="modalEmployeeForm" class="stack-form">
        <div class="field"><label>Full Name</label><input type="text" id="empName" required></div>
        <div class="field"><label>Email Address</label><input type="email" id="empEmail" required></div>
        <div class="field"><label>Password</label><input type="text" id="empPass" value="staff123" required></div>

        <div class="field">
          <label>Role</label>
          <select id="empRole">
            <option value="sales_staff">Sales Staff</option>
            <option value="store_manager">Store Manager</option>
            <option value="area_manager">Area Manager</option>
          </select>
        </div>

        <div class="field" id="singleStoreField">
          <label>Assigned Store</label>
          <select id="empStore">${singleStoreOptions}</select>
        </div>

        <div class="field" id="multiStoreField" style="display:none;">
          <label>Managed Stores</label>
          <div class="multi-check-list">
            ${multiStoreOptions || '<div class="empty-note">No stores available.</div>'}
          </div>
          <div class="field-note">Select one or more stores for this area manager.</div>
        </div>

        <div class="modal-actions mobile-actions">
          <button type="submit" class="btn btn-primary btn-block">Save Employee</button>
          <button type="button" class="btn btn-ghost btn-block" id="cancelEmployeeBtn">Cancel</button>
        </div>
      </form>
    `;

    openModal(content);

    const closeBtn = document.getElementById('closeModalBtn');
    const cancelBtn = document.getElementById('cancelEmployeeBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    const roleSelect = document.getElementById('empRole');
    const singleStoreField = document.getElementById('singleStoreField');
    const multiStoreField = document.getElementById('multiStoreField');

    const syncRoleFields = () => {
        const isArea = roleSelect.value === 'area_manager';
        singleStoreField.style.display = isArea ? 'none' : 'block';
        multiStoreField.style.display = isArea ? 'block' : 'none';
    };

    roleSelect.addEventListener('change', syncRoleFields);
    syncRoleFields();

    document.getElementById('modalEmployeeForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('empName').value.trim();
        const email = document.getElementById('empEmail').value.trim();
        const password = document.getElementById('empPass').value;
        const role = roleSelect.value;

        if (STATE.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
            alert('This email address is already registered.');
            return;
        }

        let storeId = null;
        let storeIds = null;

        if (role === 'area_manager') {
            storeIds = Array.from(document.querySelectorAll('.emp-area-store:checked')).map(el => el.value);
            if (!storeIds.length) {
                alert('Please select at least one store for the area manager.');
                return;
            }
        } else {
            storeId = document.getElementById('empStore').value;
        }

        const newEmp = {
            id: `u_staff_${uidGenerator()}`, name, email, password, role, storeId, storeIds, active: true
        };

        STATE.users.push(newEmp);

        const {persistUsers} = await import('./services.js');
        await persistUsers();

        closeModal();
        showToast('New employee added successfully!');
        triggerRender();
    });
}

export function addStoreModal(triggerRender, showToast, uidGenerator, getGeoLocation) {
    const content = `
    <h3>Add New Store</h3>
    <form id="modalStoreForm" style="margin-top:14px;">
      <div class="field"><label>Store Name</label><input type="text" id="storeNameInput" required placeholder="e.g. MG Road"></div>
      <div class="field"><label>Address</label><input type="text" id="storeAddress" required></div>
      <div class="two-col">
        <div class="field"><label>Latitude</label><input type="number" step="any" id="storeLat" required></div>
        <div class="field"><label>Longitude</label><input type="number" step="any" id="storeLng" required></div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm btn-block" id="fetchGeoBtn" style="margin-bottom:12px;">📍 Use My Current Location</button>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">Create Store</button>
        <button type="button" class="btn btn-ghost" id="closeModalBtn">Cancel</button>
      </div>
    </form>
  `;

    openModal(content);

    document.getElementById('closeModalBtn').addEventListener('click', closeModal);

    const geoBtn = document.getElementById('fetchGeoBtn');
    geoBtn.addEventListener('click', async () => {
        geoBtn.textContent = 'Locating...';
        try {
            const pos = await getGeoLocation();
            document.getElementById('storeLat').value = pos.coords.latitude;
            document.getElementById('storeLng').value = pos.coords.longitude;
            geoBtn.textContent = '📍 Location captured!';
        } catch (err) {
            alert('Could not access location: ' + err.message);
            geoBtn.textContent = '📍 Use My Current Location';
        }
    });

    document.getElementById('modalStoreForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('storeNameInput').value.trim();
        const address = document.getElementById('storeAddress').value.trim();
        const lat = parseFloat(document.getElementById('storeLat').value);
        const lng = parseFloat(document.getElementById('storeLng').value);

        const storeId = `st_${uidGenerator()}`;
        const newStore = {
            id: storeId, name, address, lat, lng, // sensible defaults; owner can edit later
            shift1Start: '10:30', shift1End: '20:30', shift2Start: '12:00', shift2End: '22:00'
        };

        STATE.stores.push(newStore);

        const {persistStores} = await import('./services.js');
        await persistStores();

        closeModal();
        showToast('New store profile generated.');
        triggerRender();
    });
}

export function manualPunchModal(triggerRender, showToast, uidGenerator) {
    const u = STATE.user;
    // Area managers (no fixed store) choose which store the missed punch was at.
    const storeChoices = u.storeId ? [] : (u.role === 'area_manager' ? storesForUser(u) : []);
    const storeField = storeChoices.length ? `<div class="field"><label>Store</label><select id="manualStore">${storeChoices.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>` : '';
    const shiftField = `<div class="field" ><label for="manualShift">Shift</label>
        <select id="manualShift" required>
          <option value="" disabled selected>Select a shift</option>
          <option value="1">Shift 1</option>
          <option value="2">Shift 2</option>
        </select>
      </div>`;
    const content = `
    <h3>Request Manual Punch-In</h3>
    <p style="font-size:12.5px;color:var(--text-soft);margin:8px 0 14px;">
      Missed punching in today? Enter your actual arrival time and a reason. This is sent to your
      store manager / area manager / owner for approval and only counts once approved.
    </p>
    <form id="manualPunchForm">
      ${storeField}
      ${shiftField}
      <div class="field"><label>Arrival time (today)</label><input type="time" id="manualTime" required></div>
      <div class="field"><label>Reason for missing punch-in</label><textarea id="manualReason" rows="2" required placeholder="e.g. Phone battery died, GPS not working…"></textarea></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">Submit for approval</button>
        <button type="button" class="btn btn-ghost" id="closeModalBtn">Cancel</button>
      </div>
    </form>
  `;

    openModal(content);

    document.getElementById('closeModalBtn').addEventListener('click', closeModal);

    document.getElementById('manualPunchForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const timeVal = document.getElementById('manualTime').value;      // "HH:MM"
        const reason = document.getElementById('manualReason').value.trim();
        const storeSel = document.getElementById('manualStore');
        const storeId = storeSel ? storeSel.value : u.storeId;
        const shiftSel = document.getElementById('manualShift');
        const shiftNumber = shiftSel ? (parseInt(shiftSel.value, 10) === 2 ? 2 : 1) : 1;
        if (!timeVal || !reason) return;
        if (!shiftSel) {
            alert('select a shift for the manual punch-in');
            return;
        }
        if (!storeId) {
            alert('Select a store for the manual punch-in.');
            return;
        }

        const now = new Date();
        const [hh, mm] = timeVal.split(':').map(Number);
        const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
        if (dt.getTime() > now.getTime()) {
            alert('Arrival time cannot be in the future.');
            return;
        }

        const {localDateStr, isLateAt} = await import('./helpers.js');
        const {persistAttendance} = await import('./services.js');
        const date = localDateStr(now);
        const store = STATE.stores.find(s => s.id === storeId);

        // Replace any rejected request for today so a fresh one can be raised.
        STATE.attendance = STATE.attendance.filter(a => !(a.userId === u.id && a.date === date && a.approvalStatus === 'rejected'));

        STATE.attendance.push({
            id: uidGenerator(),
            userId: u.id,
            storeId,
            date,
            checkInTime: dt.toISOString(),
            checkInLoc: null,
            checkOutTime: null,
            checkOutLoc: null,
            checkOutHistory: [],
            shift: shiftNumber,
            late: isLateAt(dt, store, shiftNumber),
            manual: true,
            manualReason: reason,
            approvalStatus: 'pending',
            requestedAt: now.toISOString(),
            decidedBy: null,
            decidedAt: null
        });

        await persistAttendance();
        closeModal();
        showToast('Manual punch-in submitted for approval.');
        triggerRender();
    });
}

export function editEmployeeModal(userId, triggerRender, showToast) {
    const emp = STATE.users.find(u => u.id === userId);
    if (!emp) return;

    const singleStoreOptions = STATE.stores.map(s => `<option value="${s.id}" ${emp.storeId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

    const selectedAreaStores = new Set(emp.storeIds || []);
    const multiStoreOptions = STATE.stores.map(s => `
      <label class="multi-check-row">
        <input
          type="checkbox"
          class="edit-emp-area-store"
          value="${s.id}"
          ${selectedAreaStores.has(s.id) ? 'checked' : ''}
        >
        <span>${esc(s.name)}</span>
      </label>
    `).join('');

    const roleOptions = [['sales_staff', 'Sales Staff'], ['store_manager', 'Store Manager'], ['area_manager', 'Area Manager']].map(([value, label]) => `<option value="${value}" ${emp.role === value ? 'selected' : ''}>${label}</option>`).join('');

    const content = `
      <div class="modal-head">
        <h3>Edit Employee</h3>
        <button type="button" class="icon-close" id="closeModalBtn" aria-label="Close">✕</button>
      </div>

      <form id="editEmployeeForm" class="stack-form">
        <div class="field"><label>Full Name</label><input type="text" id="editEmpName" value="${esc(emp.name)}" required></div>
        <div class="field"><label>Email Address</label><input type="email" id="editEmpEmail" value="${esc(emp.email)}" required disabled></div>
        <div class="field"><label>Role</label><select id="editEmpRole">${roleOptions}</select></div>
        <div class="field" id="editSingleStoreField" style="${emp.role === 'area_manager' ? 'display:none;' : ''}">
          <label>Assigned Store</label><select id="editEmpStore">${singleStoreOptions}</select>
        </div>
        <div class="field" id="editMultiStoreField" style="${emp.role === 'area_manager' ? '' : 'display:none;'}">
          <label>Managed Stores</label>
          <div class="multi-check-list">
            ${multiStoreOptions || '<div class="empty-note">No stores available.</div>'}
          </div></div>

        <div class="field">
          <label>Status</label>
          <select id="editEmpStatus">
            <option value="active" ${emp.active === false ? '' : 'selected'}>Active</option>
            <option value="inactive" ${emp.active === false ? 'selected' : ''}>Inactive</option>
          </select>
        </div>

        <div class="field">
          <label>Reset Password</label>
          <input type="text" id="editEmpPass" placeholder="Leave blank to keep current password">
          <div class="field-note">Only fill this if you want to change the password.</div>
        </div>

        <div class="modal-actions mobile-actions">
          <button type="submit" class="btn btn-primary btn-block">Save Changes</button>
          <button type="button" class="btn btn-ghost btn-block" id="cancelEmployeeEditBtn">Cancel</button>
        </div>
      </form>
    `;

    openModal(content);

    const closeBtn = document.getElementById('closeModalBtn');
    const cancelBtn = document.getElementById('cancelEmployeeEditBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    const roleEl = document.getElementById('editEmpRole');
    const singleStoreField = document.getElementById('editSingleStoreField');
    const multiStoreField = document.getElementById('editMultiStoreField');

    const syncRoleFields = () => {
        const isArea = roleEl.value === 'area_manager';
        singleStoreField.style.display = isArea ? 'none' : 'block';
        multiStoreField.style.display = isArea ? 'block' : 'none';
    };

    roleEl.addEventListener('change', syncRoleFields);
    syncRoleFields();

    document.getElementById('editEmployeeForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('editEmpName').value.trim();
        const email = document.getElementById('editEmpEmail').value.trim();
        const role = roleEl.value;
        const status = document.getElementById('editEmpStatus').value;
        const newPassword = document.getElementById('editEmpPass').value.trim();

        const duplicate = STATE.users.find(u => u.id !== emp.id && u.email.toLowerCase() === email.toLowerCase());
        if (duplicate) {
            alert('This email address is already registered.');
            return;
        }

        emp.name = name;
        emp.email = email;
        emp.role = role;
        emp.active = status === 'active';

        if (role === 'area_manager') {
            const storeIds = Array.from(document.querySelectorAll('.edit-emp-area-store:checked')).map(el => el.value);
            if (!storeIds.length) {
                alert('Please select at least one store for the area manager.');
                return;
            }
            emp.storeId = null;
            emp.storeIds = storeIds;
        } else {
            emp.storeId = document.getElementById('editEmpStore').value;
            emp.storeIds = null;
        }

        if (newPassword) {
            emp.password = newPassword;
        }

        const {persistUsers} = await import('./services.js');
        await persistUsers();

        closeModal();
        showToast('Employee updated successfully.');
        triggerRender();
    });
}

export function editStoreModal(storeId, triggerRender, showToast, getGeoLocation) {
    const store = STATE.stores.find(s => s.id === storeId);
    if (!store) return;

    const content = `
      <div class="modal-head">
        <h3>Edit Store</h3>
        <button type="button" class="icon-close" id="closeModalBtn" aria-label="Close">✕</button>
      </div>

      <form id="editStoreForm" class="stack-form">
        <div class="field"><label>Store Name</label><input type="text" id="editStoreName" value="${esc(store.name)}" required></div>
        <div class="field"><label>Address</label><input type="text" id="editStoreAddress" value="${esc(store.address || '')}" required></div>

        <div class="two-col mobile-two-col">
          <div class="field"><label>Latitude</label><input type="number" step="any" id="editStoreLat" value="${store.lat}" required></div>
          <div class="field"><label>Longitude</label><input type="number" step="any" id="editStoreLng" value="${store.lng}" required></div>
        </div>

        <button type="button" class="btn btn-ghost btn-block" id="fetchGeoBtn" style="margin-bottom:12px;">📍 Update from current location</button>

        <div class="section-title" style="margin:8px 0 10px;">Shift timings</div>
        <div class="two-col mobile-two-col">
          <div class="field"><label>Shift 1 Start</label><input type="time" id="editShift1Start" value="${store.shift1Start || '09:30'}" required></div>
          <div class="field"><label>Shift 1 End</label><input type="time" id="editShift1End" value="${store.shift1End || '18:00'}" required></div>
        </div>
        <div class="two-col mobile-two-col">
          <div class="field"><label>Shift 2 Start</label><input type="time" id="editShift2Start" value="${store.shift2Start || '13:00'}" required></div>
          <div class="field"><label>Shift 2 End</label><input type="time" id="editShift2End" value="${store.shift2End || '21:30'}" required></div>
        </div>

        <div class="modal-actions mobile-actions">
          <button type="submit" class="btn btn-primary btn-block">Save Changes</button>
          <button type="button" class="btn btn-ghost btn-block" id="cancelStoreEditBtn">Cancel</button>
        </div>
      </form>
    `;

    openModal(content);

    const closeBtn = document.getElementById('closeModalBtn');
    const cancelBtn = document.getElementById('cancelStoreEditBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    const geoBtn = document.getElementById('fetchGeoBtn');
    geoBtn.addEventListener('click', async () => {
        geoBtn.textContent = 'Locating...';
        try {
            const pos = await getGeoLocation();
            document.getElementById('editStoreLat').value = pos.coords.latitude;
            document.getElementById('editStoreLng').value = pos.coords.longitude;
            geoBtn.textContent = '📍 Location updated';
        } catch (err) {
            alert('Could not access location: ' + err.message);
            geoBtn.textContent = '📍 Update from current location';
        }
    });

    document.getElementById('editStoreForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        store.name = document.getElementById('editStoreName').value.trim();
        store.address = document.getElementById('editStoreAddress').value.trim();
        store.lat = parseFloat(document.getElementById('editStoreLat').value);
        store.lng = parseFloat(document.getElementById('editStoreLng').value);
        store.shift1Start = document.getElementById('editShift1Start').value;
        store.shift1End = document.getElementById('editShift1End').value;
        store.shift2Start = document.getElementById('editShift2Start').value;
        store.shift2End = document.getElementById('editShift2End').value;

        const {persistStores} = await import('./services.js');
        await persistStores();

        closeModal();
        showToast('Store updated successfully.');
        triggerRender();
    });
}

export function createTaskModal(triggerRender, showToast, uidGenerator, persistTemplates, ensureInstancesForDate, todayStr) {
    const u = STATE.user;
    const canSelectMultipleStores = u.role === 'area_manager' || u.role === 'admin';
    const accessibleStores = storesForUser(u);

    const storeOptions = accessibleStores.map(s => `
        <label class="multi-check-row">
            <input type="checkbox" class="task-store-check" value="${s.id}" ${!canSelectMultipleStores ? 'checked' : ''}>
            <span>${esc(s.name)}</span>
        </label>
    `).join('');

    const content = `
      <div class="modal-head">
        <h3>Create Task</h3>
        <button type="button" class="icon-close" id="closeModalBtn" aria-label="Close">✕</button>
      </div>

      <form id="modalTaskForm" class="stack-form">
        <div class="field">
            <label>Task Title</label>
            <input type="text" id="taskTitle" required placeholder="e.g. Clean shelves">
        </div>
        
        <div class="field" style="${canSelectMultipleStores ? '' : 'display:none;'}">
            <label>Stores</label>
            <div class="multi-check-list" id="taskStoresList" style="max-height:150px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;padding:8px;">
                ${storeOptions}
            </div>
            <div class="field-note">Tasks will be created for selected stores.</div>
        </div>

        <div class="field">
            <label>Assign To (Optional)</label>
            <select id="taskAssignee" class="form-select" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--line);">
                <option value="">Any staff member</option>
            </select>
            <div class="field-note" id="assigneeNote">Select a specific staff member.</div>
        </div>

        <div class="field">
            <label>Recurrence</label>
            <select id="taskRecurrenceType" class="form-select" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--line);">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly (Specific Days)</option>
                <option value="monthly">Monthly (Specific Date)</option>
            </select>
        </div>

        <div class="field" id="weeklyOptions" style="display:none;">
            <label>Select Days</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
                ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i) => `
                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;"><input type="checkbox" class="task-day-check" value="${i}"> ${d}</label>
                `).join('')}
            </div>
        </div>

        <div class="field" id="monthlyOptions" style="display:none;">
            <label>Day of Month</label>
            <input type="number" id="taskDayOfMonth" min="1" max="31" value="1" class="form-control" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--line);">
        </div>

        <div class="modal-actions mobile-actions" style="margin-top:24px;">
          <button type="submit" class="btn btn-primary btn-block">Create Task</button>
          <button type="button" class="btn btn-ghost btn-block" id="cancelModalBtn">Cancel</button>
        </div>
      </form>
    `;
    openModal(content);

    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

    const recType = document.getElementById('taskRecurrenceType');
    const weeklyOpt = document.getElementById('weeklyOptions');
    const monthlyOpt = document.getElementById('monthlyOptions');

    recType.addEventListener('change', () => {
        weeklyOpt.style.display = recType.value === 'weekly' ? 'block' : 'none';
        monthlyOpt.style.display = recType.value === 'monthly' ? 'block' : 'none';
    });

    const updateAssigneeDropdown = () => {
        const storeChecks = Array.from(document.querySelectorAll('.task-store-check:checked')).map(c => c.value);
        const assigneeSel = document.getElementById('taskAssignee');
        const note = document.getElementById('assigneeNote');

        if (storeChecks.length === 0) {
            assigneeSel.innerHTML = '<option value="">Any staff member</option>';
            assigneeSel.disabled = true;
            note.innerText = 'Select a store first to see available staff.';
            return;
        }
        if (storeChecks.length > 1) {
            assigneeSel.innerHTML = '<option value="">Any staff member</option>';
            assigneeSel.disabled = true;
            note.innerText = 'Assignments are disabled when multiple stores are selected.';
            return;
        }

        assigneeSel.disabled = false;
        note.innerText = 'Select a specific staff member.';
        const sid = storeChecks[0];
        const staff = STATE.users.filter(u => u.storeId === sid && u.role === 'sales_staff');
        assigneeSel.innerHTML = '<option value="">Any staff member</option>' + staff.map(st => `<option value="${st.id}">${esc(st.name)}</option>`).join('');
    };

    document.querySelectorAll('.task-store-check').forEach(cb => cb.addEventListener('change', updateAssigneeDropdown));
    updateAssigneeDropdown();

    document.getElementById('modalTaskForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('taskTitle').value.trim();
        const selectedStoreIds = Array.from(document.querySelectorAll('.task-store-check:checked')).map(c => c.value);
        if (!selectedStoreIds.length) return showToast('Please select at least one store.');

        let assignedTo = null;
        if (selectedStoreIds.length === 1 && document.getElementById('taskAssignee').value) {
            assignedTo = document.getElementById('taskAssignee').value;
        }

        let recurrence = { type: recType.value };
        if (recType.value === 'weekly') {
            const days = Array.from(document.querySelectorAll('.task-day-check:checked')).map(c => parseInt(c.value, 10));
            if (!days.length) return showToast('Please select at least one day.');
            recurrence.days = days;
        } else if (recType.value === 'monthly') {
            recurrence.dayOfMonth = parseInt(document.getElementById('taskDayOfMonth').value, 10) || 1;
        }

        selectedStoreIds.forEach(sid => {
            STATE.taskTemplates.push({
                id: uidGenerator(),
                storeId: sid,
                title,
                active: true,
                assignedTo,
                recurrence
            });
        });

        await persistTemplates();
        ensureInstancesForDate(selectedStoreIds, todayStr());
        closeModal();
        showToast('Task created successfully.');
        triggerRender();
    });
}