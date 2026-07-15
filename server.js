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

app.get('/api/storage/:key', async (req, res) => {
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
  try {
    await DataModel.findOneAndUpdate(
        { key: req.params.key },
        { value: req.body.value },
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
