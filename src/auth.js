/**
 * Authentication middleware
 * Melindungi route yang memerlukan login.
 */

export function requireAuth(req, res, next) {
  if (req.session && req.session.admin) {
    next();
  } else {
    // Jika request API, return 401 JSON
    // req.path sudah di-strip oleh mount point, jadi gunakan req.originalUrl
    // yang mempertahankan path lengkap (mis. /api/notifications)
    if (req.originalUrl.startsWith('/api/') || req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Silakan login terlebih dahulu' });
    }
    // Jika request halaman, redirect ke login
    return res.redirect('/login');
  }
}

/**
 * Redirect ke dashboard jika sudah login (untuk halaman login)
 */
export function redirectIfAuth(req, res, next) {
  if (req.session && req.session.admin) {
    return res.redirect('/dashboard');
  }
  next();
}

export default { requireAuth, redirectIfAuth };
