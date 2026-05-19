import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { renderApprovalPage } from './approval-page.js';
import { approvalErrorResponse, submitApprovalSignature } from './approval-service.js';

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && cryptoTimingSafeEqual(left, right);
}

function cryptoTimingSafeEqual(left, right) {
  try {
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function bearerToken(req) {
  const value = req.get('authorization') || '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

export function createApiAuthMiddleware(apiToken) {
  if (!apiToken) return (_req, _res, next) => next();
  return (req, res, next) => {
    if (timingSafeEqualString(bearerToken(req), apiToken)) return next();
    res.status(401).json({ error: 'unauthorized' });
  };
}

export function createRateLimitMiddleware({ windowMs = 60_000, max = 60 } = {}) {
  if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isFinite(max) || max <= 0) {
    return (_req, _res, next) => next();
  }

  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const current = hits.get(key);
    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      res.set('RateLimit-Limit', String(max));
      res.set('RateLimit-Remaining', String(max - 1));
      return next();
    }

    current.count += 1;
    const remaining = Math.max(0, max - current.count);
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(remaining));
    res.set('RateLimit-Reset', String(Math.ceil(current.resetAt / 1000)));

    if (current.count > max) {
      return res.status(429).json({ error: 'rate_limited', retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) });
    }
    next();
  };
}

function securityHeaders(_req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.set('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  next();
}

export function createApp({ store, provider = null, apiToken = process.env.SAFEGIT_API_TOKEN, corsOrigin = process.env.SAFEGIT_CORS_ORIGIN || '*', trustProxy = process.env.SAFEGIT_TRUST_PROXY, rateLimit = {} } = {}) {
  const app = express();
  if (trustProxy) app.set('trust proxy', trustProxy === 'true' ? 1 : trustProxy);
  app.use(securityHeaders);
  app.use(cors({ origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean) }));
  app.use(express.json({ limit: '1mb' }));

  const windowMs = Number(rateLimit.windowMs ?? process.env.SAFEGIT_RATE_LIMIT_WINDOW_MS ?? 60_000);
  const max = Number(rateLimit.max ?? process.env.SAFEGIT_RATE_LIMIT_MAX ?? 60);
  app.use('/api/', createRateLimitMiddleware({ windowMs, max }));
  app.use('/api/', createApiAuthMiddleware(apiToken));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.get('/approve/:approvalId', async (req, res, next) => {
    try {
      const approval = await store.getApproval(req.params.approvalId);
      if (!approval) return res.status(404).send('Approval not found');
      res.type('html').send(renderApprovalPage(req.params.approvalId, { apiAuthRequired: Boolean(apiToken) }));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/approvals/:approvalId', async (req, res, next) => {
    try {
      const approval = await store.getApproval(req.params.approvalId);
      if (!approval) return res.status(404).json({ error: 'approval_not_found' });
      res.json(approval);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/approvals/:approvalId/signatures', async (req, res, next) => {
    try {
      const result = await submitApprovalSignature({
        store,
        provider,
        approvalId: req.params.approvalId,
        signer: req.body?.signer,
        signature: req.body?.signature
      });
      res.json(result);
    } catch (error) {
      const response = approvalErrorResponse(error);
      if (response) return res.status(response.status).json(response.body);
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: 'internal_error', message: error.message || String(error) });
  });

  return app;
}
