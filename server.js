const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to MongoDB Atlas"))
  .catch(err => console.error("Database connection error:", err));

// Single Schema to replicate the key-value structures cleanly
const DataSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

const DataModel = mongoose.model('DataRecord', DataSchema);

// Get route
app.get('/api/storage/:key', async (req, res) => {
  try {
    const record = await DataModel.findOne({ key: req.params.key });
    return res.json(record ? record.value : null);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Save route
app.post('/api/storage/:key', async (req, res) => {
  try {
    const record = await DataModel.findOneAndUpdate(
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
