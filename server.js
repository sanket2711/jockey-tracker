const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
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
    // allow non-browser tools (curl/Postman have no Origin)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
  optionsSuccessStatus: 204
}));

// Explicit preflight handler (important with custom headers)
app.options('*', cors());

const authMiddleware = (req, res, next) => {
  // Never require API key on preflight
  if (req.method === 'OPTIONS') return next();

  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas'))
    .catch(err => console.error('Database connection error:', err));

const DataSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

const DataModel = mongoose.model('DataRecord', DataSchema);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', authMiddleware);

// Sanitized users endpoint — strips passwords before sending
app.get('/api/users', async (req, res) => {
  try {
    const record = await DataModel.findOne({ key: 'users' });
    const users = record ? record.value : [];
    const safe = users.map(({ password, ...rest }) => rest); // strip password
    return res.json(safe);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Login endpoint — verifies credentials server-side, never exposes password list
const bcrypt = require('bcryptjs');

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const record = await DataModel.findOne({ key: 'users' });
    const users = record ? record.value : [];
    const u = users.find(x => x.email.toLowerCase() === (email || '').trim().toLowerCase() && x.active !== false);
    if (!u) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, u.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const { password: _pw, ...safeUser } = u;
    return res.json(safeUser);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/storage/:key', async (req, res) => {
  if (req.params.key === 'users') {
    return res.status(403).json({ error: 'Use /api/users instead' });
  }
  try {
    const record = await DataModel.findOne({ key: req.params.key });
    return res.json(record ? record.value : null);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/storage/:key', async (req, res) => {
  if (req.body.value === undefined || req.body.value === null) {
    return res.status(400).json({ error: 'value is required' });
  }
  let value = req.body.value;
  if (req.params.key === 'users' && Array.isArray(value)) {
    value = await Promise.all(value.map(async u => {
      if (u.password && !u.password.startsWith('$2')) { // not already hashed
        u.password = await bcrypt.hash(u.password, 10);
      }
      return u;
    }));
  }
  try {
    await DataModel.findOneAndUpdate(
        { key: req.params.key },
        { value },
        { upsert: true, new: true }
    );
    return res.json({ success: true });
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
