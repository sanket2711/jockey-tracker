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
    month: new Date(),
    navOpen: false,
    toast: null
};

export const BACKEND_API_URL = "https://jockey-tracker.onrender.com";
export const SHIFT_START_MIN = 9 * 60 + 30; // 9:30am
export const GRACE_MIN = 15;
export const RADIUS_M = 100;