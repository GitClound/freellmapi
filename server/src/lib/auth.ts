import type { Request, Response } from 'express';
import { getUnifiedApiKey } from '../db/index.js';

function isLocalRequest(req: Request): boolean {
  return req.ip === '127.0.0.1'
    || req.ip === '::1'
    || req.ip === '::ffff:127.0.0.1';
}

export function requireUnifiedApiKey(req: Request, res: Response): boolean {
  // Local dashboard and CLI calls skip auth because they are coming from the
  // same machine running the proxy. Non-local clients must send the unified key.
  if (isLocalRequest(req)) return true;

  const bearerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const xApiKey = req.headers['x-api-key'];
  const token = bearerToken
    || (Array.isArray(xApiKey) ? xApiKey[0] : xApiKey);

  if (!token || token !== getUnifiedApiKey()) {
    res.status(401).json({
      error: { message: 'Invalid API key', type: 'authentication_error' },
    });
    return false;
  }

  return true;
}
