import express from 'express';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './config.js';
import { requireAuth } from './auth.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import pageRoutes from './routes/pages.js';
import { startMonitor, stopMonitor } from './services/monitor.js';
import { getSetting } from './db.js';
import { writeDnsmasqBlocklist } from './services/dns-blocklist.js';
import { writeVpnInternetAccessState } from './services/vpn-access.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Trust proxy (untuk nginx reverse proxy - X-Forwarded-Proto, X-Real-IP)
app.set('trust proxy', 1);

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(join(__dirname, '..', 'public')));

// Session
app.use(session({
  name: 'connect.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 jam
    secure: 'auto', // Cookie secure pada HTTPS; tetap kompatibel dengan HTTP lokal.
    sameSite: 'lax',
  },
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', join(__dirname, '..', 'views'));

// Health check endpoint (publik, tanpa auth - untuk Docker healthcheck)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), mode: config.demoMode ? 'demo' : 'real' });
});

// ============================================================
// ROUTES
// ============================================================

// Auth routes (publik)
app.use('/', authRoutes);

// API routes (harus login)
app.use('/api', requireAuth, apiRoutes);

// Page routes (GET /login publik, sisanya butuh login)
app.use('/', (req, res, next) => {
  // /login dan non-GET request (seperti POST /logout) tidak butuh auth di sini
  if (req.path === '/login' || req.method !== 'GET') return next();
  requireAuth(req, res, next);
}, pageRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    code: 404,
    message: 'Halaman tidak ditemukan',
    admin: req.session?.admin,
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  // API routes harus return JSON, bukan HTML error page
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(500).json({
      error: 'Server error',
      message: config.nodeEnv === 'development' ? err.message : 'Terjadi kesalahan server',
    });
  }
  res.status(500).render('error', {
    code: 500,
    message: 'Terjadi kesalahan server',
    admin: req.session?.admin,
    error: config.nodeEnv === 'development' ? err.message : null,
  });
});

// ============================================================
// START & GRACEFUL SHUTDOWN
// ============================================================
// Akses aplikasi melalui reverse proxy (Nginx), bukan langsung dari jaringan.
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log('==================================================');
  console.log('  Web VPN Monitor Versi 1.0');
  console.log('==================================================');
  console.log(`  Server:    http://localhost:${config.port}`);
  console.log(`  Mode:      ${config.demoMode ? 'DEMO (mock data)' : 'REAL (live data)'}`);
  console.log(`  Environment: ${config.nodeEnv}`);
  console.log('==================================================');
  console.log(`  Admin:     ${config.adminUsername} (password set in .env)`);
  console.log('==================================================');

  try {
    writeDnsmasqBlocklist();
  } catch (error) {
    console.error('[DNS] Gagal menyinkronkan blocklist ke dnsmasq:', error.message);
  }
  try {
    writeVpnInternetAccessState();
  } catch (error) {
    console.error('[VPN] Gagal menyinkronkan pengaturan akses internet:', error.message);
  }

  // Mulai monitoring service (cek setting - bisa di-pause via UI)
  const monitorActive = getSetting('monitor_active', 'true');
  if (monitorActive !== 'false') {
    startMonitor();
  } else {
    console.log('  Mode:      MONITORING PAUSED (dijeda via UI)');
  }
});

// Graceful shutdown (SIGTERM dari Docker stop, SIGINT dari Ctrl+C)
function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Graceful shutdown...`);
  stopMonitor();
  server.close(() => {
    console.log('[Server] HTTP server ditutup');
    process.exit(0);
  });
  // Force exit setelah 10 detik jika tidak selesai
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
