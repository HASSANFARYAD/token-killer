import { ConfidentialClientApplication } from '@azure/msal-node';
import { config } from '../config.js';

const msalApps = new Map();

function getMsalApp(tenantId = config.microsoft.tenantId) {
  if (msalApps.has(tenantId)) return msalApps.get(tenantId);

  const app = new ConfidentialClientApplication({
    auth: {
      clientId: config.microsoft.clientId,
      clientSecret: config.microsoft.clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
    system: {
      loggerOptions: {
        loggerCallback: () => {},
        piiLoggingEnabled: false,
        logLevel: 3,
      },
    },
  });

  msalApps.set(tenantId, app);
  return app;
}

export function getAuthCodeUrl({ tenantId, state, nonce } = {}) {
  const app = getMsalApp(tenantId || config.microsoft.tenantId);
  return app.getAuthCodeUrl({
    scopes: config.microsoft.scopes,
    redirectUri: config.microsoft.redirectUri,
    state: state || '',
    nonce: nonce || '',
    responseMode: 'query',
  });
}

export async function exchangeCode(code, { tenantId, nonce } = {}) {
  const app = getMsalApp(tenantId || config.microsoft.tenantId);
  const result = await app.acquireTokenByCode({
    code,
    scopes: config.microsoft.scopes,
    redirectUri: config.microsoft.redirectUri,
    nonce,
  });
  return result;
}

export async function acquireClientCredentialToken(tenantId, clientId, clientSecret) {
  const app = new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
  });
  const result = await app.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return result;
}

export function extractUserFromIdToken(tokenClaims) {
  return {
    microsoftId: tokenClaims.oid,
    email: tokenClaims.preferred_username || tokenClaims.email || tokenClaims.upn,
    displayName: tokenClaims.name || '',
    givenName: tokenClaims.given_name || '',
    surname: tokenClaims.family_name || '',
    tenantId: tokenClaims.tid,
  };
}
