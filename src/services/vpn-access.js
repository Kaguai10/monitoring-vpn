import { writeFileSync } from 'fs';
import config from '../config.js';
import { getSetting } from '../db.js';

export function writeVpnInternetAccessState() {
  if (config.demoMode) return false;
  const enabled = getSetting('vpn_internet_access_enabled', 'true') === 'true';
  writeFileSync(config.vpnInternetAccessFilePath, `${enabled ? 'true' : 'false'}\n`, { mode: 0o644 });
  return true;
}
