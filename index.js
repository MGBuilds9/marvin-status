const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Point to the vault status file (mounted volume)
const STATUS_FILE = process.env.STATUS_FILE || '/data/marvin/status.json';

app.use(express.static('public'));

app.get('/api/status', (req, res) => {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const data = fs.readFileSync(STATUS_FILE, 'utf8');
      res.json(JSON.parse(data));
    } else {
      res.json({ status: 'offline', error: 'Status file not found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Marvin Status running on port ${PORT}`);
});