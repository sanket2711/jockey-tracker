import { STATE, BACKEND_API_URL, API_KEY } from './config.js';

export async function saveKey(key, value, shared) {
    try {
        if (!shared) {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        }
        const response = await fetch(`${BACKEND_API_URL}/api/storage/${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
            body: JSON.stringify({ value })
        });
        if (!response.ok) throw new Error('Network error');
        return true;
    } catch (e) {
        console.error('Save failed', key, e);
        return false;
    }
}

export async function loadKey(key, shared) {
    try {
        if (!shared) {
            const localData = localStorage.getItem(key);
            return localData ? JSON.parse(localData) : null;
        }
        const response = await fetch(`${BACKEND_API_URL}/api/storage/${key}`, {
            headers: { 'x-api-key': API_KEY }});
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.error('Load failed', key, e);
        return null;
    }
}

export const persistStores = () => saveKey('stores', STATE.stores, true);
export const persistUsers = () => saveKey('users', STATE.users, true);
export const persistTemplates = () => saveKey('task_templates', STATE.taskTemplates, true);
export const persistInstances = () => saveKey('task_instances', STATE.taskInstances, true);
export const persistAttendance = () => saveKey('attendance', STATE.attendance, true);
export const persistLeaves = () => saveKey('leaves', STATE.leaves, true);

export function seedData() {
    const stores = [
        {
            id: 'st_a',
            name: 'Koregaon Park',
            address: 'North Main Road, Koregaon Park, Pune',
            lat: 18.5159,
            lng: 73.9472,
            shift1Start: '09:30',
            shift1End: '18:00',
            shift2Start: '12:30',
            shift2End: '21:00'
        },
        {
            id: 'st_b',
            name: 'Baner',
            address: 'Baner Road, Pune',
            lat: 18.5590,
            lng: 73.7868,
            shift1Start: '10:00',
            shift1End: '18:30',
            shift2Start: '13:00',
            shift2End: '21:30'
        },
        {
            id: 'st_c',
            name: 'Kothrud',
            address: 'Karve Road, Kothrud, Pune',
            lat: 18.5074,
            lng: 73.8077,
            shift1Start: '09:00',
            shift1End: '17:30',
            shift2Start: '12:30',
            shift2End: '21:00'
        },
        {
            id: 'st_d',
            name: 'Viman Nagar',
            address: 'Viman Nagar Main Road, Pune',
            lat: 18.5679,
            lng: 73.9143,
            shift1Start: '09:30',
            shift1End: '18:00',
            shift2Start: '13:00',
            shift2End: '21:30'
        },
    ];
    const users = [
        { id: 'u_admin', name: 'Ananya Kulkarni', email: 'admin@storeflow.demo', password: 'admin123', role: 'admin', storeId: null, storeIds: null, active: true },
        { id: 'u_area1', name: 'Rohan Mehta', email: 'rohan.area@storeflow.demo', password: 'area123', role: 'area_manager', storeId: null, storeIds: ['st_a', 'st_d'], active: true },
        { id: 'u_area2', name: 'Priya Nair', email: 'priya.area@storeflow.demo', password: 'area123', role: 'area_manager', storeId: null, storeIds: ['st_b', 'st_c'], active: true },
        { id: 'u_mgr_a', name: 'Vikram Shah', email: 'vikram.manager@storeflow.demo', password: 'manager123', role: 'store_manager', storeId: 'st_a', storeIds: null, active: true },
        { id: 'u_mgr_b', name: 'Sneha Joshi', email: 'sneha.manager@storeflow.demo', password: 'manager123', role: 'store_manager', storeId: 'st_b', storeIds: null, active: true },
        { id: 'u_mgr_c', name: 'Arjun Desai', email: 'arjun.manager@storeflow.demo', password: 'manager123', role: 'store_manager', storeId: 'st_c', storeIds: null, active: true },
        { id: 'u_mgr_d', name: 'Meera Iyer', email: 'meera.manager@storeflow.demo', password: 'manager123', role: 'store_manager', storeId: 'st_d', storeIds: null, active: true },
    ];
    const staffNames = [
        ['Aditi Rao','st_a'],['Karan Bhosale','st_a'],['Neha Pawar','st_a'],['Siddharth Kale','st_a'],['Ishita Deshmukh','st_a'],
        ['Yash Kulkarni','st_b'],['Pooja Shinde','st_b'],['Rahul Gaikwad','st_b'],['Simran Kaur','st_b'],
        ['Aman Jadhav','st_c'],['Divya Patil','st_c'],['Manoj Chavan','st_c'],['Ritika Sawant','st_c'],
        ['Farhan Sheikh','st_d'],['Gauri Kadam','st_d'],['Om Bhagat','st_d'],['Tanvi More','st_d'],['Rohit Salunkhe','st_d'],
    ];
    staffNames.forEach((s, i) => {
        users.push({ id: 'u_staff' + i, name: s[0], email: 'staff' + (i + 1) + '@storeflow.demo', password: 'staff123', role: 'sales_staff', storeId: s[1], storeIds: null, active: true });
    });
    const taskTitles = ['Open store & switch on lights', 'Clean & organize shelves', 'Check & log stock levels', 'Update daily sales register', 'Close store & lock up'];
    const taskTemplates = [];
    stores.forEach(st => { taskTitles.forEach((t, i) => { taskTemplates.push({ id: 'tt_' + st.id + '_' + i, storeId: st.id, title: t, active: true, assignedTo: null, recurrence: { type: 'daily' } }); }); });
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

export function storeName(id) { const s = STATE.stores.find(x => x.id === id); return s ? s.name : '—'; }
export function userName(id) { const u = STATE.users.find(x => x.id === id); return u ? u.name : 'Unknown'; }