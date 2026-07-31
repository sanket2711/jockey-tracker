const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(express.json());

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://jockey-tracker-three.vercel.app',
  'http://localhost:63342',
  'https://jockey-tracker-dev.vercel.app'
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
  optionsSuccessStatus: 204
}));

app.options('*', cors());

// ─── App-level API key check (proves this is our frontend, not user identity) ───
const authMiddleware = (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ─── MongoDB ──────────────────────────────────────────────────────────────────
const DataSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });
const DataModel = mongoose.model('DataRecord', DataSchema);

mongoose.connect(process.env.MONGO_URI)
  .then(async () => { await initSeedIfNeeded(); })
  .catch(err => console.error('Database connection error:', err));

async function initSeedIfNeeded() {
  const existing = await DataModel.findOne({ key: 'users' });
  if (!existing || !existing.value || existing.value.length === 0) {
    const rawUsers = [
      { id: 'u_admin1', name: 'Sanket Baheti', email: 'sanket.baheti', password: 'admin123', role: 'admin', storeId: null, storeIds: null, active: true },
      { id: 'u_area1', name: 'Dinesh Pardeshi', email: 'dinesh.pardeshi', password: 'area123', role: 'area_manager', storeId: null, storeIds: ['st_a', 'st_b', 'st_c', 'st_d'], active: true },
      { id: 'u_mgr_a', name: 'Sundar Maske', email: 'sundar.maske', password: 'manager123', role: 'store_manager', storeId: 'st_a', storeIds: null, active: true },
      { id: 'u_mgr_b', name: 'Omkar Shinde', email: 'omkar.shinde', password: 'manager123', role: 'store_manager', storeId: 'st_b', storeIds: null, active: true },
      { id: 'u_mgr_c', name: 'Kalyan More', email: 'kalyan.more', password: 'manager123', role: 'store_manager', storeId: 'st_c', storeIds: null, active: true },
      { id: 'u_mgr_d', name: 'Dinesh Vedpathak', email: 'dinesh.vedpathak', password: 'manager123', role: 'store_manager', storeId: 'st_d', storeIds: null, active: true },
      { id: 'u_staff_1', name: 'Adarsh Palkhe', email: 'adarsh.palkhe', password: 'staff123', role: 'sales_staff', storeId: 'st_a', storeIds: null, active: true },
      { id: 'u_staff_2', name: 'Aarti Giri', email: 'aarti.giri', password: 'staff123', role: 'sales_staff', storeId: 'st_a', storeIds: null, active: true },
      { id: 'u_staff_3', name: 'Ranita Karji', email: 'ranita.karji', password: 'staff123', role: 'sales_staff', storeId: 'st_a', storeIds: null, active: true },
      { id: 'u_staff_4', name: 'Reshma Ali', email: 'reshma.ali', password: 'staff123', role: 'sales_staff', storeId: 'st_a', storeIds: null, active: true },
      { id: 'u_staff_5', name: 'Tulshiram Shelar', email: 'tulshiram.shelar', password: 'staff123', role: 'sales_staff', storeId: 'st_a', storeIds: null, active: true },
      { id: 'u_staff_6', name: 'Amol Chavan', email: 'amol.chavan', password: 'staff123', role: 'sales_staff', storeId: 'st_b', storeIds: null, active: true },
      { id: 'u_staff_7', name: 'Datta Dombe', email: 'datta.dombe', password: 'staff123', role: 'sales_staff', storeId: 'st_b', storeIds: null, active: true },
      { id: 'u_staff_8', name: 'Karuna Sawant', email: 'karuna.sawant', password: 'staff123', role: 'sales_staff', storeId: 'st_b', storeIds: null, active: true },
      { id: 'u_staff_9', name: 'Trupti Satam', email: 'trupti.satam', password: 'staff123', role: 'sales_staff', storeId: 'st_b', storeIds: null, active: true },
      { id: 'u_staff_10', name: 'Sagar Ahir', email: 'sagar.ahir', password: 'staff123', role: 'sales_staff', storeId: 'st_b', storeIds: null, active: true },
      { id: 'u_staff_11', name: 'Supriya Kinagi', email: 'supriya.kinagi', password: 'staff123', role: 'sales_staff', storeId: 'st_b', storeIds: null, active: true },
      { id: 'u_staff_12', name: 'Achal Kumar', email: 'achal.kumar', password: 'staff123', role: 'sales_staff', storeId: 'st_c', storeIds: null, active: true },
      { id: 'u_staff_13', name: 'Sheetal Pawar', email: 'sheetal.pawar', password: 'staff123', role: 'sales_staff', storeId: 'st_c', storeIds: null, active: true },
      { id: 'u_staff_14', name: 'Shrabani Sarkar', email: 'shrabani.sarkar', password: 'staff123', role: 'sales_staff', storeId: 'st_c', storeIds: null, active: true },
      { id: 'u_staff_15', name: 'Hina', email: 'hina', password: 'staff123', role: 'sales_staff', storeId: 'st_d', storeIds: null, active: true },
      { id: 'u_staff_16', name: 'Mayuri', email: 'mayuri', password: 'staff123', role: 'sales_staff', storeId: 'st_d', storeIds: null, active: true },
      { id: 'u_staff_17', name: 'Pranav', email: 'pranav', password: 'staff123', role: 'sales_staff', storeId: 'st_d', storeIds: null, active: true },
      { id: 'u_staff_18', name: 'Yash', email: 'yash', password: 'staff123', role: 'sales_staff', storeId: 'st_d', storeIds: null, active: true }
    ];
    const users = await Promise.all(rawUsers.map(async u => ({
      ...u, password: await bcrypt.hash(u.password, 10)
    })));
    await DataModel.findOneAndUpdate({ key: 'users' }, { value: users }, { upsert: true });
    console.log('🌱 Initial users seeded into MongoDB');
  }
}

// ─── Helpers: server-side scope resolution ────────────────────────────────────
function authorizedStoreIdsFor(u) {
  if (u.role === 'admin') return null;           // null = all stores
  if (u.role === 'area_manager') return u.storeIds || [];
  if (u.storeId) return [u.storeId];             // store_manager, sales_staff
  return [];
}

function scopeStores(all, storeIds) {
  if (storeIds === null) return all;
  return all.filter(s => storeIds.includes(s.id));
}

function scopeUsers(all, u, storeIds) {
  const safe = all.map(({ password, ...rest }) => rest);
  if (u.role === 'admin') return safe;
  if (u.role === 'area_manager') {
    return safe.filter(x =>
      x.role !== 'admin' &&
      (storeIds.includes(x.storeId) || x.id === u.id)
    );
  }
  if (u.role === 'store_manager') {
    return safe.filter(x =>
      (x.storeId === u.storeId && x.role === 'sales_staff') ||
      x.id === u.id
    );
  }
  // sales_staff sees only themselves
  return safe.filter(x => x.id === u.id);
}

function scopeAttendance(all, u, storeIds) {
  if (u.role === 'admin') return all;
  if (u.role === 'area_manager' || u.role === 'store_manager') {
    return all.filter(r => storeIds.includes(r.storeId) || storeIds.includes(r.homeStoreId));
  }
  return all.filter(r => r.userId === u.id);
}

function scopeTaskTemplates(all, storeIds) {
  if (storeIds === null) return all;
  return all.filter(t => storeIds.includes(t.storeId));
}

function scopeTaskInstances(all, storeIds) {
  if (storeIds === null) return all;
  return all.filter(i => storeIds.includes(i.storeId));
}

function scopeLeaves(all, u, storeIds) {
  if (u.role === 'admin') return all;
  if (u.role === 'area_manager' || u.role === 'store_manager') {
    return all.filter(l => storeIds.includes(l.storeId) || l.userId === u.id);
  }
  return all.filter(l => l.userId === u.id);
}

function scopeDutyRosters(all, u, storeIds) {
  if (u.role === 'admin') return all;
  if (u.role === 'area_manager') {
    return all.filter(r =>
      (r.type === 'store' && storeIds.includes(r.storeId)) ||
      (r.type === 'am')
    );
  }
  if (u.role === 'store_manager') {
    return all.filter(r =>
      (r.type === 'store' && storeIds.includes(r.storeId)) ||
      (r.type === 'am')
    );
  }
  return all.filter(r =>
    (r.type === 'store' && storeIds.includes(r.storeId))
  );
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', authMiddleware);

// Login — returns safe user object (no password)
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const record = await DataModel.findOne({ key: 'users' });
    const users = record ? record.value : [];
    const u = users.find(x => x.email.toLowerCase() === (email || '').trim().toLowerCase() && x.active !== false);
    if (!u || !u.password) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, u.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const { password: _pw, ...safeUser } = u;
    return res.json(safeUser);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── NEW: Single scoped data fetch endpoint ───────────────────────────────────
// POST /api/data  { userId }
// Returns ALL collections pre-filtered for the requesting user's role + scope.
// Nothing sensitive is sent that the user is not authorized to see.
app.post('/api/data', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const [usersRec, storesRec, templatesRec, attendanceRec, instancesRec, leavesRec, rostersRec] =
      await Promise.all([
        DataModel.findOne({ key: 'users' }),
        DataModel.findOne({ key: 'stores' }),
        DataModel.findOne({ key: 'task_templates' }),
        DataModel.findOne({ key: 'attendance' }),
        DataModel.findOne({ key: 'task_instances' }),
        DataModel.findOne({ key: 'leaves' }),
        DataModel.findOne({ key: 'duty_rosters' })
      ]);

    const allUsers   = usersRec     ? usersRec.value     : [];
    const allStores  = storesRec    ? storesRec.value    : [];
    const allTpls    = templatesRec ? templatesRec.value : [];
    const allAtt     = attendanceRec  ? attendanceRec.value  : [];
    const allInst    = instancesRec   ? instancesRec.value   : [];
    const allLeaves  = leavesRec      ? leavesRec.value      : [];
    const allRosters = rostersRec     ? rostersRec.value     : [];

    // Resolve requesting user from DB — client CANNOT lie about role
    const u = allUsers.find(x => x.id === userId && x.active !== false);
    if (!u) return res.status(403).json({ error: 'User not found or inactive' });

    const storeIds = authorizedStoreIdsFor(u); // null = admin (all)
    const resolvedIds = storeIds === null ? allStores.map(s => s.id) : storeIds;

    return res.json({
      stores:         scopeStores(allStores, storeIds),
      users:          scopeUsers(allUsers, u, resolvedIds),
      task_templates: scopeTaskTemplates(allTpls, storeIds),
      attendance:     scopeAttendance(allAtt, u, resolvedIds),
      task_instances: scopeTaskInstances(allInst, storeIds),
      leaves:         scopeLeaves(allLeaves, u, resolvedIds),
      duty_rosters:   scopeDutyRosters(allRosters, u, resolvedIds)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Save endpoint — still generic but app-key protected ─────────────────────
app.post('/api/storage/:key', async (req, res) => {
  if (req.body.value === undefined || req.body.value === null) {
    return res.status(400).json({ error: 'value is required' });
  }
  let value = req.body.value;

  if (req.params.key === 'users' && Array.isArray(value)) {
    const existingRecord = await DataModel.findOne({ key: 'users' });
    const existingUsers = existingRecord ? existingRecord.value : [];
    const existingById = new Map(existingUsers.map(u => [u.id, u]));

    value = await Promise.all(value.map(async u => {
      if (!u.password) {
        const prior = existingById.get(u.id);
        if (prior && prior.password) u.password = prior.password;
      } else if (!u.password.startsWith('$2')) {
        u.password = await bcrypt.hash(u.password, 10);
      }
      return u;
    }));
  }

  try {
    await DataModel.findOneAndUpdate({ key: req.params.key }, { value }, { upsert: true, new: true });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Legacy GET — blocked for all sensitive collections
const BLOCKED_LEGACY_KEYS = ['users', 'attendance', 'task_instances', 'leaves', 'duty_rosters'];
app.get('/api/storage/:key', async (req, res) => {
  if (BLOCKED_LEGACY_KEYS.includes(req.params.key)) {
    return res.status(403).json({ error: `Use POST /api/data instead for ${req.params.key}` });
  }
  try {
    const record = await DataModel.findOne({ key: req.params.key });
    return res.json(record ? record.value : null);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

process.on('SIGTERM', async () => {
  await mongoose.connection.close();
  process.exit(0);
});
