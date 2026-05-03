import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";

/** Require a valid Clerk session. Responds 401 if not authenticated. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  next();
}
