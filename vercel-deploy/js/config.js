export const STATE = {
    user: null,
    page: 'dashboard',
    stores: [],
    users: [],
    attendance: [],
    taskTemplates: [],
    taskInstances: [],
    leaves: [],
    ready: false,
    punchStatus: '',
    punchOk: null,
    punchStoreId: null,
    punchShift: null,
    month: new Date(),
    navOpen: false,
    toast: null,
    reportFilterStoreIds: [],
    reportFilterStaffIds: [],
    attendanceFilterStoreIds: [],
    attendanceFilterStaffIds: [],
    teamFilterStoreIds: [],
    teamFilterStaffIds: [],
    activeDropdown: null,
    dutyRosters: [],
    rosterWeekOffset: 0,
    rosterEditingId: null
};

export const BACKEND_API_URL = "https://jockey-tracker.onrender.com";
export const SHIFT_START_MIN = 9 * 60 + 30; // keep as global fallback
export const GRACE_MIN = 15;
export const RADIUS_M = 70;
export const API_KEY= "ab55035076cb427d5a74e9a0d842791b";