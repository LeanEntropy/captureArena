// Basic-auth gate for /stats. Single shared password from STATS_PASSWORD env;
// any username is accepted. Fail-closed: if STATS_PASSWORD is unset we return
// 503 so the dashboard can never be served accidentally without a password.

import type { Request, Response, NextFunction } from "express";
import auth from "basic-auth";

let warned = false;

export function statsAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expected = process.env.STATS_PASSWORD;
  if (!expected) {
    if (!warned) {
      console.warn(
        "[stats] STATS_PASSWORD is not set — /stats will return 503 until configured"
      );
      warned = true;
    }
    res.status(503).send("stats dashboard not configured (set STATS_PASSWORD)");
    return;
  }

  const creds = auth(req);
  if (!creds || creds.pass !== expected) {
    res.set("WWW-Authenticate", 'Basic realm="stats"');
    res.status(401).send("authentication required");
    return;
  }

  next();
}
