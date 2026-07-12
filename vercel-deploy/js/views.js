import { STATE } from './config.js';
import { esc, fmtTime, fmtDate, fmtDateShort, roleLabel } from './helpers.js';
import { storeName, userName, storesForUser, storeIdsForUser, employeesForUser } from './services.js';
import { todayStr, RADIUS_M, todayRecordFor, monthlyReport } from './app.js';

export function renderLogin() {
    const demo = [
        ['Admin / Owner', 'admin@storeflow.demo', 'admin123'],
        ['Area Manager', 'rohan.area@storeflow.demo', 'area123'],
        ['Store Manager', 'vikram.manager@storeflow.demo', 'manager123'],
        ['Sales Staff', 'staff1@storeflow.demo', 'staff123'],
    ];
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
    if (role === 'admin') { base.push(['team', 'Team']); base.push(['stores', 'Stores']); }
    return base;
}

export function pageTitle(p) { return { dashboard: 'Dashboard', attendance: 'Attendance', tasks: 'Daily Tasks', leave: 'Leave', reports: 'Reports', team: 'Team', stores: 'Stores' }[p] || ''; }

export function pageSubtitle(u) {
    if (u.role === 'admin') return 'All 4 stores';
    if (u.role === 'area_manager') return storesForUser(u).map(s => s.name).join(' · ');
    return storeName(u.storeId);
}

export function renderPunchWidget() {
    const u = STATE.user, store = STATE.stores.find(s => s.id === u.storeId);
    const rec = todayRecordFor(u.id);
    const now = new Date();
    let btnHtml, statusColor = STATE.punchOk === false ? 'var(--alert)' : (STATE.punchOk ? 'var(--success)' : 'rgba(255,255,255,0.75)');
    if (!rec) {
        btnHtml = `<button class="punch-btn" id="punchInBtn">Punch In</button>`;
    } else if (!rec.checkOutTime) {
        btnHtml = `<button class="punch-btn out" id="punchOutBtn">Punch Out</button>`;
    } else {
        btnHtml = `<button class="punch-btn" disabled>Done for Today</button>`;
    }
    return `
  <div class="punch-wrap">
    <div class="punch-card">
      <div class="punch-time mono">${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      <div class="punch-date">${fmtDate(todayStr())}</div>
      <div class="punch-store">${store ? esc(store.name) + ' · within ' + RADIUS_M + 'm required' : 'No store assigned'}</div>
      ${btnHtml}
      <div class="punch-status" style="color:${statusColor}">${esc(STATE.punchStatus || '')}</div>
    </div>
    <div class="ticket">
      <h3>Today's Punch</h3>
      <div class="ticket-row"><span class="lbl">Check-in</span><span class="val">${rec ? fmtTime(rec.checkInTime) : '—'}</span></div>
      <div class="ticket-row"><span class="lbl">Status</span><span class="val">${rec ? (rec.late ? '<span class="pill pill-late">Late</span>' : '<span class="pill pill-present">On time</span>') : '—'}</span></div>
      <div class="ticket-row"><span class="lbl">Check-out</span><span class="val">${rec ? fmtTime(rec.checkOutTime) : '—'}</span></div>
      <div class="ticket-row"><span class="lbl">Geo-fence</span><span class="val">${RADIUS_M}m radius</span></div>
    </div>
  </div>`;
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
    const label = STATE.month.toLocaleDateString([], { month: 'long', year: 'numeric' });
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
    const scopedStaff = STATE.users.filter(x => ids.includes(x.storeId));
    const todaysAtt = STATE.attendance.filter(a => ids.includes(a.storeId) && a.date === today);
    const presentCount = todaysAtt.length;
    const lateCount = todaysAtt.filter(a => a.late).length;
    const attPct = scopedStaff.length ? Math.round(presentCount / scopedStaff.length * 100) : 0;
    const todaysTasks = STATE.taskInstances.filter(i => ids.includes(i.storeId) && i.date === today);
    const tasksDone = todaysTasks.filter(t => t.completed).length;
    const taskPct = todaysTasks.length ? Math.round(tasksDone / todaysTasks.length * 100) : 0;
    const pendingLeaves = STATE.leaves.filter(l => ids.includes(l.storeId) && l.status === 'pending');

    let personalPunch = '';
    if (u.storeId) {
        personalPunch = `<div class="section-title">Your Punch<span class="hint">Today · ${storeName(u.storeId)}</span></div>${renderPunchWidget()}`;
    }

    const storeRows = storesForUser(u).map(s => {
        const staff = STATE.users.filter(x => x.storeId === s.id);
        const att = STATE.attendance.filter(a => a.storeId === s.id && a.date === today);
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
  <div class="section-title">Pending Leave Requests<span class="hint">${pendingLeaves.length}</span></div>
  ${pendingLeaves.length ? renderLeaveTable(pendingLeaves, true) : '<div class="empty-note">Nothing pending.</div>'}
  `;
}

export function renderAttendancePage() {
    const u = STATE.user, ids = storeIdsForUser(u), today = todayStr();
    let html = '';
    if (u.storeId) { html += renderPunchWidget(); }
    const staffScope = u.role === 'sales_staff' ? [u] : STATE.users.filter(x => ids.includes(x.storeId) && x.role !== 'admin' && x.role !== 'area_manager');
    const rows = staffScope.map(s => {
        const rec = STATE.attendance.find(a => a.userId === s.id && a.date === today);
        let pill = '<span class="pill pill-absent">Absent</span>';
        if (rec) pill = rec.late ? '<span class="pill pill-late">Late</span>' : '<span class="pill pill-present">Present</span>';
        return `<tr><td><b>${esc(s.name)}</b><div class="badge-role">${esc(roleLabel(s.role))}</div></td><td>${esc(storeName(s.storeId))}</td>
      <td>${rec ? fmtTime(rec.checkInTime) : '—'}</td><td>${rec ? fmtTime(rec.checkOutTime) : '—'}</td><td>${pill}</td></tr>`;
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
    const canManage = u.role === 'store_manager' || u.role === 'admin';
    let html = '';
    storesForUser(u).forEach(s => {
        const tasks = STATE.taskInstances.filter(t => t.storeId === s.id && t.date === today);
        const done = tasks.filter(t => t.completed).length;
        html += `<div class="section-title">${esc(s.name)}<span class="hint">${done}/${tasks.length} complete</span></div>
    <div class="table-wrap">${tasks.map(t => `
      <div class="task-row">
        <div class="task-check ${t.completed ? 'done' : ''}" data-toggle="${t.id}">${t.completed ? '✓' : ''}</div>
        <div class="task-title ${t.completed ? 'done' : ''}">${esc(t.title)}</div>
        <div class="task-meta">${t.completed ? 'done by ' + esc(userName(t.completedBy)) + ' · ' + fmtTime(t.completedAt) : ''}</div>
      </div>`).join('') || '<div class="empty-note">No tasks configured for this store yet.</div>'}
    </div>
    ${canManage && (u.role === 'admin' || u.storeId === s.id) ? `
      <div class="inline-form">
        <input type="text" placeholder="Add a recurring daily task…" id="taskInput_${s.id}">
        <button class="btn btn-ghost btn-sm" data-addtask="${s.id}">Add</button>
      </div>
      <details style="margin-top:8px;"><summary class="subtle-link">Manage checklist (${STATE.taskTemplates.filter(t => t.storeId === s.id && t.active).length} active)</summary>
      <div style="margin-top:8px;">
      ${STATE.taskTemplates.filter(t => t.storeId === s.id && t.active).map(t => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 2px;font-size:13px;">
          <span>${esc(t.title)}</span><span class="subtle-link" style="color:var(--alert)" data-removetpl="${t.id}">Remove</span>
        </div>`).join('')}
      </div></details>` : ''}
    `;
    });
    return html || '<div class="empty-note">No stores in your scope.</div>';
}

export function renderLeavePage() {
    const u = STATE.user, ids = storeIdsForUser(u);
    let html = '';
    if (u.role !== 'admin' && u.role !== 'area_manager') {
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
    const scoped = u.role === 'sales_staff' || u.role === 'store_manager'
        ? STATE.leaves.filter(l => u.role === 'sales_staff' ? l.userId === u.id : ids.includes(l.storeId))
        : STATE.leaves.filter(l => ids.includes(l.storeId));
    const canDecide = u.role === 'store_manager' || u.role === 'area_manager' || u.role === 'admin';
    const pending = scoped.filter(l => l.status === 'pending');
    const decided = scoped.filter(l => l.status !== 'pending');
    html += `<div class="section-title">Pending<span class="hint">${pending.length}</span></div>
  ${pending.length ? renderLeaveTable(pending, canDecide) : '<div class="empty-note">Nothing pending.</div>'}
  <div class="section-title">History</div>
  ${decided.length ? renderLeaveTable(decided, false) : '<div class="empty-note">No past requests.</div>'}
  `;
    return html;
}

export function renderReportsPage() {
    const u = STATE.user;
    const staff = employeesForUser(u).filter(x => x.role === 'sales_staff' || x.role === 'store_manager');
    const summary = staff.map(s => {
        const rep = monthlyReport(s.id, STATE.month);
        const total = rep.present + rep.late + rep.absent + rep.leave;
        const pct = total ? Math.round((rep.present + rep.late) / total * 100) : 0;
        return `<tr><td><b>${esc(s.name)}</b><div class="badge-role">${esc(roleLabel(s.role))} · ${esc(storeName(s.storeId))}</div></td>
      <td style="color:var(--success)">${rep.present}</td><td style="color:var(--amber-dark)">${rep.late}</td>
      <td style="color:var(--alert)">${rep.absent}</td><td style="color:var(--steel)">${rep.leave}</td><td>${pct}%</td></tr>`;
    }).join('');
    return `
  ${renderMonthPicker()}
  <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Present</th><th>Late</th><th>Absent</th><th>Leave</th><th>Attendance</th></tr></thead>
  <tbody>${summary || '<tr><td colspan="6" class="empty-note">No staff in scope.</td></tr>'}</tbody></table></div>
  `;
}

export function renderTeamPage() {
    const rows = STATE.users.filter(u => u.role !== 'admin').map(u => `
    <tr><td><b>${esc(u.name)}</b><div class="badge-role">${esc(u.email)}</div></td>
    <td>${esc(roleLabel(u.role))}</td>
    <td>${u.role === 'area_manager' ? (u.storeIds || []).map(storeName).join(', ') : esc(storeName(u.storeId))}</td>
    <td>${u.active === false ? '<span class="pill pill-absent">Inactive</span>' : '<span class="pill pill-present">Active</span>'}</td>
    <td><span class="subtle-link" data-toggleactive="${u.id}">${u.active === false ? 'Reactivate' : 'Deactivate'}</span></td></tr>`).join('');
    return `
  <div class="section-title">All Employees<span class="hint">${STATE.users.filter(u => u.role !== 'admin').length} people</span></div>
  <button class="btn btn-amber btn-sm" id="addEmployeeBtn">+ Add employee</button>
  <div class="table-wrap" style="margin-top:14px;"><table><thead><tr><th>Name</th><th>Role</th><th>Store(s)</th><th>Status</th><th></th></tr></thead>
  <tbody>${rows}</tbody></table></div>
  `;
}

export function renderStoresPage() {
    const rows = STATE.stores.map(s => {
        const staff = STATE.users.filter(x => x.storeId === s.id).length;
        return `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.address || '—')}</td><td class="mono">${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}</td><td>${staff}</td></tr>`;
    }).join('');
    return `
  <div class="section-title">Stores<span class="hint">${STATE.stores.length}</span></div>
  <button class="btn btn-amber btn-sm" id="addStoreBtn">+ Add store</button>
  <div class="table-wrap" style="margin-top:14px;"><table><thead><tr><th>Store</th><th>Address</th><th>Coordinates</th><th>Staff</th></tr></thead>
  <tbody>${rows}</tbody></table></div>
  <p style="font-size:12px;color:var(--text-faint);margin-top:10px;">Coordinates define the center of the ${RADIUS_M}m check-in geofence for each store.</p>
  `;
}