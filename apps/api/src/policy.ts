import { Router, type RequestHandler } from 'express';
import type { Capability } from '@the-pocket/shared';

/** Every API route must declare who may call it: a named capability, or "member" (any signed-in member). */
export type Policy = Capability | 'member';

export interface RegisteredRoute {
  method: 'get' | 'post';
  path: string;
  policy: Policy;
}

/**
 * The ONLY way routes are added to the API. Requiring a policy argument makes deny-by-default
 * structural: a route without one cannot be written. The registry also drives the automated
 * permission-matrix test, so new routes are covered the moment they are added.
 */
export class PolicyRouter {
  readonly router = Router();
  readonly routes: RegisteredRoute[] = [];

  private add(method: 'get' | 'post', path: string, policy: Policy, handlers: RequestHandler[]) {
    this.routes.push({ method, path, policy });
    // The capability check always runs first, before any other middleware or handler.
    this.router[method](path, requireCapability(policy), ...handlers);
  }

  get(path: string, policy: Policy, ...handlers: RequestHandler[]) {
    this.add('get', path, policy, handlers);
  }

  post(path: string, policy: Policy, ...handlers: RequestHandler[]) {
    this.add('post', path, policy, handlers);
  }
}

export function requireCapability(policy: Policy): RequestHandler {
  return (req, res, next) => {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json({ error: 'Please sign in to continue.' });
      return;
    }
    if (policy !== 'member' && !auth.capabilities.includes(policy)) {
      res.status(403).json({ error: 'You do not have permission to do that.' });
      return;
    }
    next();
  };
}
