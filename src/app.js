const express = require('express');
const ticketRoutes = require('./routes/ticket.routes');
const healthRoutes = require('./routes/health.routes');
const errorHandler = require('./middlewares/error.middleware');
const { apiKeyAuth } = require('./middlewares/auth.middleware');

const app = express();

// ── Middleware ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── CORS (Konfigurasi dinamis via CORS_ORIGIN) ──
app.use((req, res, next) => {
  const allowedOrigins = (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const requestOrigin = req.headers.origin;

  if (allowedOrigins.includes('*')) {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    res.header('Access-Control-Allow-Origin', requestOrigin);
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Routes ──
app.use('/api/tickets', apiKeyAuth, ticketRoutes);
app.use('/api/health', healthRoutes);

// ── Root ──
app.get('/', (req, res) => {
  res.json({
    name: 'Selis Molis Hoki (SMH) WhatsApp Support System',
    version: '1.0.0',
    status: 'running',
  });
});

// ── 404 ──
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan' });
});

// ── Error Handler ──
app.use(errorHandler);

module.exports = app;
