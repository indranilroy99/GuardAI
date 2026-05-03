/**
 * API Router — All features available to authenticated users (no tiers).
 * Webhook endpoint in integrations is publicly accessible (token-auth).
 */
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import alertsRouter from "./alerts";
import awsRouter from "./aws";
import auditRouter from "./audit";
import advancedRouter from "./advanced";
import authRouter from "./auth";
import integrationsRouter from "./integrations";
import terminalRouter from "./terminal";
import accountsRouter from "./accounts";
import huntRouter from "./hunt";
import huntSchedulesRouter from "./hunt-schedules";
import mitreRouter from "./mitre";
import incidentsRouter from "./incidents";
import fpEngineRouter from "./fp-engine";
import notificationsRouter from "./notifications";
import { requireAuth } from "../middlewares/auth-check";

const router: IRouter = Router();

// Public — no auth required
router.use(healthRouter);
router.use(authRouter);

// Webhook is token-authenticated (not session-authenticated)
router.use(integrationsRouter);

// All features — require Clerk session
router.use(requireAuth);
router.use(alertsRouter);
router.use(awsRouter);
router.use(auditRouter);
router.use(advancedRouter);
router.use(terminalRouter);
router.use(accountsRouter);
router.use(huntRouter);
router.use(huntSchedulesRouter);
router.use(mitreRouter);
router.use(incidentsRouter);
router.use(fpEngineRouter);
router.use(notificationsRouter);

export default router;
