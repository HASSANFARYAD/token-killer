const DEFAULT_AGENT_URL = 'http://127.0.0.1:17687';

function agentBaseUrl() {
  return process.env.RTK_AGENT_URL || DEFAULT_AGENT_URL;
}

export async function getAgentStatus({ timeoutMs = 500 } = {}) {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${agentBaseUrl()}/status`, {
      method: 'GET',
      signal: controller.signal
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const LOCAL_AGENT_ENDPOINTS = [
  'GET /status',
  'GET /sessions',
  'POST /events',
  'POST /sync',
  'POST /tools/register'
];

