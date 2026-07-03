import { acquireClientCredentialToken } from '../auth/microsoft.js';
import { decrypt } from './crypto.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function getGraphToken(tenant) {
  const secret = decrypt(tenant.client_secret_enc);
  const result = await acquireClientCredentialToken(tenant.aad_tenant_id, tenant.client_id, secret);
  return result.accessToken;
}

async function graphGet(token, path, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(`${GRAPH_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '10', 10);
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(`Graph API error ${res.status}: ${err.error?.message || res.statusText}`);
    }
    return res.json();
  }
  throw new Error('Graph API request failed after retries');
}

export async function fetchAllUsers(tenant) {
  const token = await getGraphToken(tenant);
  const users = [];
  let url = '/users?$select=id,displayName,givenName,surname,mail,userPrincipalName,department,jobTitle,accountEnabled&$top=999';

  while (url) {
    const page = await graphGet(token, url);
    users.push(...(page.value || []));
    url = page['@odata.nextLink']
      ? page['@odata.nextLink'].replace(GRAPH_BASE, '')
      : null;
  }
  return users;
}

export async function fetchDeltaUsers(tenant, deltaToken) {
  const token = await getGraphToken(tenant);
  const users = [];
  let newDeltaToken = null;
  let url = deltaToken
    ? `/users/delta?$deltaToken=${deltaToken}`
    : '/users/delta?$select=id,displayName,givenName,surname,mail,userPrincipalName,department,jobTitle,accountEnabled';

  while (url) {
    const page = await graphGet(token, url);
    users.push(...(page.value || []));

    if (page['@odata.deltaLink']) {
      const match = page['@odata.deltaLink'].match(/\$deltaToken=([^&]+)/);
      newDeltaToken = match ? match[1] : null;
      url = null;
    } else {
      url = page['@odata.nextLink']
        ? page['@odata.nextLink'].replace(GRAPH_BASE, '')
        : null;
    }
  }
  return { users, deltaToken: newDeltaToken };
}

export function normalizeGraphUser(graphUser) {
  return {
    microsoft_id: graphUser.id,
    email: graphUser.mail || graphUser.userPrincipalName || '',
    display_name: graphUser.displayName || '',
    given_name: graphUser.givenName || null,
    surname: graphUser.surname || null,
    department: graphUser.department || null,
    job_title: graphUser.jobTitle || null,
    account_enabled: graphUser.accountEnabled !== false,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
