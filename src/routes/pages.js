import { Router } from 'express';
import { redirectIfAuth } from '../auth.js';
import config from '../config.js';

const router = Router();

/**
 * Halaman login
 */
router.get('/login', redirectIfAuth, (req, res) => {
  res.render('login', { demoMode: config.demoMode });
});

/**
 * Dashboard
 */
router.get('/dashboard', (req, res) => {
  res.render('dashboard', {
    admin: req.session.admin,
    demoMode: config.demoMode,
    page: 'dashboard',
  });
});

/**
 * User list
 */
router.get('/users', (req, res) => {
  res.render('users', {
    admin: req.session.admin,
    demoMode: config.demoMode,
    page: 'users',
  });
});

router.get('/users/register', (req, res) => {
  res.render('users-tools', { admin: req.session.admin, demoMode: config.demoMode, page: 'users-register', toolPage: 'register' });
});

router.get('/users/export', (req, res) => {
  res.render('users-tools', { admin: req.session.admin, demoMode: config.demoMode, page: 'users-export', toolPage: 'export' });
});

router.get('/users/manage', (req, res) => {
  res.render('users-tools', { admin: req.session.admin, demoMode: config.demoMode, page: 'users-manage', toolPage: 'manage' });
});

/**
 * User preview/detail
 */
router.get('/users/:ip', (req, res) => {
  res.render('preview', {
    admin: req.session.admin,
    demoMode: config.demoMode,
    page: 'users',
    peerIp: req.params.ip,
  });
});

/**
 * Notifications
 */
router.get('/notifications', (req, res) => {
  res.render('notifications', {
    admin: req.session.admin,
    demoMode: config.demoMode,
    page: 'notifications',
  });
});

/**
 * Settings
 */
router.get('/settings', (req, res) => {
  res.render('settings', {
    admin: req.session.admin,
    demoMode: config.demoMode,
    page: 'settings',
  });
});

/**
 * Root redirect
 */
router.get('/', (req, res) => {
  if (req.session && req.session.admin) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

export default router;
