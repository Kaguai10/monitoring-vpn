import { Router } from 'express';
import { verifyAdmin, checkAdminPassword, updateAdminPassword } from '../db.js';
import config from '../config.js';

const router = Router();

/**
 * POST /login - proses login
 */
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  const admin = verifyAdmin(username, password);
  if (!admin) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }

  req.session.admin = { id: admin.id, username: admin.username };
  return res.json({ success: true, redirect: '/dashboard' });
});

/**
 * POST /logout - proses logout
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Gagal logout' });
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true, redirect: '/login' });
  });
});

/**
 * POST /change-password - ganti password (harus login)
 */
router.post('/change-password', (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Password lama dan baru wajib diisi' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password baru minimal 8 karakter' });
  }

  const username = req.session.admin.username;
  if (!checkAdminPassword(username, currentPassword)) {
    return res.status(400).json({ error: 'Password lama salah' });
  }

  if (!updateAdminPassword(username, newPassword)) {
    return res.status(500).json({ error: 'Gagal mengubah password' });
  }

  return res.json({ success: true, message: 'Password berhasil diubah' });
});

/**
 * POST /reset-password - reset password menggunakan reset key
 * Digunakan dari halaman "Lupa Password" tanpa perlu login
 */
router.post('/reset-password', (req, res) => {
  const { resetKey, newPassword } = req.body;

  if (!resetKey || !newPassword) {
    return res.status(400).json({ error: 'Reset key dan password baru wajib diisi' });
  }

  if (resetKey !== config.resetKey) {
    return res.status(403).json({ error: 'Reset key tidak valid' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password baru minimal 8 karakter' });
  }

  // Reset password administrator
  if (!updateAdminPassword('administrator', newPassword)) {
    return res.status(500).json({ error: 'Gagal reset password' });
  }

  return res.json({ success: true, message: 'Password administrator berhasil direset. Silakan login.' });
});

export default router;
