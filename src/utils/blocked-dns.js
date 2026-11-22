import { getSetting } from '../db.js';

/**
 * Daftar domain DNS yang diblokir untuk user VPN.
 * Aturan jaringan aktif ditulis ke konfigurasi dnsmasq dari Settings.
 *
 * Matching dilakukan dengan sufiks domain (domain dan semua subdomain nya).
 * Contoh: "whatsapp.com" akan match "whatsapp.com", "web.whatsapp.com", dll.
 */

export const BLOCKED_DNS = [
  // WhatsApp
  'whatsapp.com',
  'whatsapp.net',
  'whatsapp.org',
  'wa.me',

  // Telegram
  'telegram.org',
  'telegram.me',
  't.me',
  'telegra.ph',

  // Discord
  'discord.com',
  'discord.gg',
  'discordapp.com',
  'discordapp.net',

  // TikTok
  'tiktok.com',
  'tiktokv.com',
  'tiktokcdn.com',

  // Instagram
  'instagram.com',
  'cdninstagram.com',

  // --- Tambahan (bisa dihapus jika tidak dipakai) ---

  // Social Media
  'facebook.com',
  'fbcdn.net',
  'twitter.com',
  'x.com',
  'snapchat.com',
  'reddit.com',
  'pinterest.com',
  'linkedin.com',
  'tumblr.com',

  // Gaming
  'steampowered.com',
  'steamcommunity.com',
  'epicgames.com',
  'roblox.com',
];

/** Cek apakah domain diblokir */
export function isDomainBlocked(domain) {
  const d = domain.toLowerCase().trim().replace(/\.$/, '');
  let list;
  try {
    list = JSON.parse(getSetting('blocked_dns_list', JSON.stringify(BLOCKED_DNS)));
    if (getSetting('ai_blocking_enabled', 'true') === 'true') {
      const aiList = JSON.parse(getSetting('ai_dns_list', '[]'));
      list = [...list, ...aiList.map(entry => typeof entry === 'string' ? entry : entry.domain)];
    }
  } catch {
    list = BLOCKED_DNS;
  }
  return list.some(blocked => {
    const b = blocked.toLowerCase();
    return d === b || d.endsWith('.' + b);
  });
}

/** Default blocked list untuk settings (bisa diubah via UI) */
export const DEFAULT_BLOCKED_DNS_JSON = JSON.stringify(BLOCKED_DNS, null, 2);

