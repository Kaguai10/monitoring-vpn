import { getSetting } from '../db.js';

/**
 * Daftar domain yang terkait dengan layanan AI.
 * Digunakan untuk mendeteksi user yang mengakses AI (ChatGPT, Claude, Gemini, dll).
 *
 * Setiap entry punya:
 *  - domain: domain yang akan di-match (sufiks match)
 *  - service: nama layanan AI yang akan ditampilkan
 */

export const AI_DNS = [
  // OpenAI / ChatGPT
  { domain: 'openai.com',         service: 'OpenAI / ChatGPT' },
  { domain: 'chatgpt.com',        service: 'ChatGPT' },
  { domain: 'oaistatic.com',      service: 'OpenAI / ChatGPT' },
  { domain: 'oaiusercontent.com',  service: 'OpenAI / ChatGPT' },
  { domain: 'sora.com',           service: 'OpenAI Sora' },

  // Anthropic / Claude
  { domain: 'anthropic.com',      service: 'Anthropic / Claude' },
  { domain: 'claude.ai',          service: 'Claude AI' },

  // Google / Gemini
  { domain: 'gemini.google.com',  service: 'Google Gemini' },
  { domain: 'bard.google.com',    service: 'Google Gemini (Bard)' },
  { domain: 'generativelanguage.googleapis.com', service: 'Google Gemini API' },
  { domain: 'aistudio.google.com', service: 'Google AI Studio' },

  // Microsoft / Copilot
  { domain: 'copilot.microsoft.com', service: 'Microsoft Copilot' },
  { domain: 'sydney.bing.com',    service: 'Microsoft Copilot (Bing)' },

  // Perplexity
  { domain: 'perplexity.ai',      service: 'Perplexity AI' },

  // Other AI
  { domain: 'huggingface.co',     service: 'Hugging Face' },
  { domain: 'character.ai',       service: 'Character.AI' },
  { domain: 'poe.com',           service: 'Poe (Quora AI)' },
  { domain: 'midjourney.com',     service: 'Midjourney' },
  { domain: 'stability.ai',       service: 'Stability AI' },
  { domain: 'groq.com',           service: 'Groq' },
  { domain: 'mistral.ai',         service: 'Mistral AI' },
  { domain: 'x.ai',              service: 'xAI / Grok' },
  { domain: 'deepseek.com',       service: 'DeepSeek AI' },
  { domain: 'leonardo.ai',        service: 'Leonardo AI' },
  { domain: 'runwayml.com',       service: 'Runway AI' },
  { domain: 'civitai.com',        service: 'CivitAI' },
  { domain: 'ollama.com',         service: 'Ollama' },
  { domain: 'opencode.ai',        service: 'OpenCode' },
  { domain: 'sider.ai',            service: 'Sider AI' },
  { domain: 'duck.ai',             service: 'Duck.ai' },
  { domain: 'z.ai',                service: 'Z.ai' },
];

/** Cek apakah domain adalah akses AI, return nama service atau null */
export function checkAiDomain(domain) {
  const d = domain.toLowerCase().trim();
  let list;
  try { list = JSON.parse(getSetting('ai_dns_list', JSON.stringify(AI_DNS))); } catch { list = AI_DNS; }
  for (const raw of list) {
    const entry = typeof raw === 'string' ? { domain: raw, service: raw } : raw;
    const e = entry.domain.toLowerCase();
    if (d === e || d.endsWith('.' + e)) {
      return entry.service;
    }
  }
  return null;
}

export const DEFAULT_AI_DNS_JSON = JSON.stringify(AI_DNS, null, 2);
