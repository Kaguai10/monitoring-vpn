import { writeFileSync } from 'fs';
import config from '../config.js';
import { BLOCKED_DNS } from '../utils/blocked-dns.js';
import { AI_DNS } from '../utils/ai-dns.js';
import { getSetting } from '../db.js';

function normalizedDomains(list) {
  return [...new Set(list.map(value => String(value).trim().toLowerCase().replace(/\.$/, '')))]
    .filter(domain => /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain));
}

export function writeDnsmasqBlocklist() {
  if (config.demoMode) return false;
  const blocked = JSON.parse(getSetting('blocked_dns_list', JSON.stringify(BLOCKED_DNS)));
  const ai = JSON.parse(getSetting('ai_dns_list', JSON.stringify(AI_DNS)));
  const domains = [...blocked];
  if (getSetting('ai_blocking_enabled', 'true') === 'true') {
    domains.push(...ai.map(entry => typeof entry === 'string' ? entry : entry.domain));
  }
  const content = '# Managed by Web VPN Monitor settings. Do not edit manually.\n'
    + normalizedDomains(domains).map(domain => `address=/${domain}/`).join('\n') + '\n';
  writeFileSync(config.dnsmasqBlockedConfigPath, content, { mode: 0o644 });
  return true;
}
