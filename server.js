const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'https://your-project.vercel.app',
    'http://localhost:3000'
  ]
}));

const authMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Connected to MongoDB Atlas"))
    .catch(err => console.error("Database connection error:", err));

const DataSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

const DataModel = mongoose.model('DataRecord', DataSchema);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Apply auth to all API routes
app.use('/api', authMiddleware);

// GET route
app.get('/api/storage/:key', async (req, res) => {
  try {
    const record = await DataModel.findOne({ key: req.params.key });
    return res.json(record ? record.value : null);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST route
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