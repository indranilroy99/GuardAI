import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { clerkMiddleware } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware.js";
import router from "./routes";
import { logger } from "./lib/logger";
import { auditMiddleware } from "./middlewares/audit.js";

const app: Express = express();

// Trust reverse proxy (Replit nginx) — required for secure cookies + real IPs
app.set("trust proxy", 1);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://*.clerk.accounts.dev"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://img.clerk.com"],
        connectSrc: ["'self'", "https://*.clerk.accounts.dev", "https://clerk.*.replit.app", "https://api.clerk.dev", "https://ipinfo.io", "http://ip-api.com"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded. Please slow down." },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown",
  message: { error: "AI rate limit exceeded. Please wait before running more analyses." },
});

const awsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "AWS request rate limit exceeded." },
});

app.use(generalLimiter);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);

// Clerk proxy — must be BEFORE body parsers (streams raw bytes)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ origin: true, credentials: true }));

// Body parsing with 1MB cap
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Clerk session middleware — reads CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY from env
app.use(clerkMiddleware());

// Rate limits on expensive routes
const webhookLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use("/api/alerts", (req, res, next) => { if (req.method === "POST") { aiLimiter(req, res, next); return; } next(); });
app.use("/api/integrations/guardduty/webhook", webhookLimiter);
app.use("/api/aws/investigate", aiLimiter);
app.use("/api/aws/blast-radius", aiLimiter);
app.use("/api/aws/kill-chain", aiLimiter);
app.use("/api/aws", awsLimiter);

// Audit trail
app.use(auditMiddleware);

app.use("/api", router);

export default app;
