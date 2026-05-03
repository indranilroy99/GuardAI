# GuardAI — AWS Security Operations Platform

> Enterprise-grade AWS GuardDuty alert triage, AI-powered analysis, MITRE ATT&CK mapping, and real-time incident response — built for security operations teams.

![GuardAI](https://img.shields.io/badge/GuardAI-v2.0-ff9900?style=for-the-badge&logo=amazonaws&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

---

## Table of Contents

- [Overview](#overview)
- [Screenshots](#screenshots)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
  - [Running with Docker](#running-with-docker)
- [Database](#database)
- [API Reference](#api-reference)
- [Authentication](#authentication)
- [AI Integration](#ai-integration)
- [AWS Integration](#aws-integration)
- [Deployment](#deployment)
- [Contributing](#contributing)

---

## Overview

GuardAI is a full-stack security operations platform that ingests AWS GuardDuty findings, triages them with AI, maps them to the MITRE ATT&CK framework, and gives your security team a unified workspace to investigate, respond, and audit every alert.

Built on a **pnpm monorepo** with a contract-first OpenAPI workflow — the OpenAPI spec drives Zod validation on the server and auto-generated React Query hooks on the client.

---

## Features

### Security Command Center
- Posture score gauge with trend history
- MTTD / MTTR / threat velocity metrics
- 7-day threat timeline chart
- MITRE tactic coverage grid
- Asset exposure breakdown by resource type
- Multi-account active account badge (respects global timeframe filter)

### Alert Queue
- Full CRUD on GuardDuty alerts
- 5-stage AI triage pipeline (IOC enrichment → blast radius → kill chain → MITRE mapping → remediation)
- Real-time SSE feed (`/api/alerts/stream`)
- Verdict tracking (TRUE_POSITIVE / FALSE_POSITIVE) with confidence score
- Status workflow: `pending → generated → applied → failed`
- Per-alert analyst notes with author attribution and delete-on-hover
- **Watch Alert** — subscribe to an alert; get in-app notifications on any change
- **Change History Timeline** — full audit trail of status changes, notes, and verdict flips per alert
- FP suggestion banner with one-click bulk-apply

### Live Findings
- Pull directly from AWS GuardDuty API with region and severity filtering
- Auto-ingest findings into the alert queue

### AI Analyzer
- Paste raw GuardDuty JSON → instant MITRE mapping + Boto3 remediation script
- Supports OpenRouter (free open-source models) or OpenAI GPT-4o

### Incident Timeline
- Auto-correlates alerts by tactic / resource / account
- Kill-chain progression bar
- Vertical event log
- AI-generated analyst narrative (attacker profile, objective, response actions)

### MITRE ATT&CK Heatmap
- Full 14-tactic matrix
- Cells colour-coded by alert count
- Drill-down breakdown table per tactic

### Threat Hunt
- Natural-language query → AI interprets → DB searched → narrative summary
- 10 pre-built hunt templates
- Scheduled hunts: hourly / daily / weekly background runner
- Webhook notifications + in-app bell panel for hunt results

### FP Learning Engine
- Extracts false-positive patterns from verdict history
- Scores new alerts against known-safe patterns
- Auto-suspect scan for all un-triaged alerts
- Bulk-verdict with one click

### In-App Notifications
- Watch any alert to receive change notifications
- Notification bell in top bar with unread count badge
- Dropdown panel showing recent activity on watched alerts
- Auto-polls every 30 seconds; read state tracked via localStorage

### Infrastructure
- Multi-account AWS credential management
- In-browser Cloud Shell (xterm.js) with AWS CLI pre-configured
- AI Agent Hub with AES-256-GCM encrypted API key storage

### Audit & Compliance
- Tamper-evident audit log for all write operations
- Auto-redacts sensitive fields
- CSV export

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Monorepo** | pnpm workspaces |
| **Language** | TypeScript 5.9 (strict) |
| **Runtime** | Node.js 24 |
| **Frontend** | React 19 + Vite 7 + TailwindCSS 4 |
| **UI Components** | shadcn/ui + Radix UI |
| **Icons** | Lucide React |
| **Routing** | wouter |
| **Data fetching** | TanStack Query v5 |
| **Backend** | Express 5 |
| **Database** | PostgreSQL 17 + Drizzle ORM |
| **Validation** | Zod v4 + drizzle-zod |
| **API codegen** | Orval (OpenAPI → Zod + React Query hooks) |
| **Build** | esbuild (API), Vite (frontend) |
| **Auth** | Clerk (Google SSO + email/password) |
| **AI (primary)** | OpenRouter — Llama 3.3 70B (free tier available) |
| **AI (fallback)** | OpenAI GPT-4o |
| **AWS SDK** | STS, GuardDuty, EC2, IAM, CloudTrail, S3, Lambda, CloudWatch Logs, RDS, EKS |
| **Terminal** | xterm.js + node-pty |
| **Security** | Helmet CSP, express-rate-limit, express-session |
| **Logging** | Pino (structured JSON) |

---

## Project Structure

```
guardai/
├── artifacts/
│   ├── api-server/               # Express API (serves /api)
│   │   └── src/
│   │       ├── routes/           # All route handlers
│   │       │   ├── alerts.ts     # Alert CRUD, notes, watch, activity
│   │       │   ├── fp-engine.ts  # False Positive Learning Engine
│   │       │   ├── hunt.ts       # Threat Hunt + scheduler
│   │       │   ├── incidents.ts  # Incident timeline + AI narrative
│   │       │   ├── mitre.ts      # MITRE ATT&CK heatmap
│   │       │   ├── aws.ts        # Live findings, blast radius, kill chain
│   │       │   ├── accounts.ts   # Multi-account management
│   │       │   ├── audit.ts      # Audit log
│   │       │   ├── terminal.ts   # Cloud Shell exec
│   │       │   └── ...
│   │       ├── lib/
│   │       │   ├── analyze-alert.ts    # AI triage pipeline
│   │       │   ├── record-activity.ts  # Shared activity recorder
│   │       │   └── ...
│   │       └── middlewares/
│   │           ├── auth-check.ts  # Clerk session guard
│   │           └── audit.ts       # Fire-and-forget audit logging
│   │
│   └── guardduty-analyzer/       # React + Vite frontend (serves /)
│       └── src/
│           ├── pages/             # One file per route
│           │   ├── dashboard.tsx
│           │   ├── alert-detail.tsx  # Alert detail + notes + watch + timeline
│           │   ├── alerts.tsx
│           │   ├── hunt.tsx
│           │   ├── fp-engine.tsx
│           │   ├── incidents.tsx
│           │   ├── mitre.tsx
│           │   └── ...
│           ├── components/
│           │   ├── layout.tsx     # Sidebar + top bar + notification bell
│           │   └── ...
│           └── lib/
│               ├── auth-context.tsx      # Clerk wrapper hook
│               ├── theme-context.tsx     # Dark/light mode
│               └── global-filters-context.tsx
│
├── lib/
│   ├── api-spec/
│   │   └── openapi.yaml          # Single source of truth for all API contracts
│   ├── api-client-react/         # Auto-generated React Query hooks (do not edit)
│   ├── api-zod/                  # Auto-generated Zod schemas (do not edit)
│   └── db/
│       └── src/schema/
│           ├── alerts.ts
│           ├── alert-notes.ts
│           ├── alert-watchers.ts  # Watch subscriptions
│           ├── alert-activity.ts  # Change history events
│           ├── audit-logs.ts
│           ├── accounts.ts
│           └── hunt-schedules.ts
│
├── .env.example                  # All required environment variables
├── docker-compose.yml            # One-command local dev with Postgres
├── pnpm-workspace.yaml
└── package.json
```

---

## Getting Started

### Prerequisites

- **Node.js** 20+ (22 or 24 recommended)
- **pnpm** 9+ — `npm install -g pnpm`
- **PostgreSQL** 14+ (or use the included Docker Compose)

### Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SESSION_SECRET` | ✅ | Long random string for session signing (`openssl rand -hex 64`) |
| `CLERK_SECRET_KEY` | ✅ | From [Clerk dashboard](https://dashboard.clerk.com) → API Keys |
| `VITE_CLERK_PUBLISHABLE_KEY` | ✅ | From Clerk dashboard (public, starts with `pk_`) |
| `AI_PROVIDER` | ✅ | `openrouter` or `openai` |
| `AI_MODEL` | — | Override default model |
| `OPENAI_API_KEY` | If using OpenAI | `sk-...` |
| `AI_INTEGRATIONS_OPENROUTER_API_KEY` | If using OpenRouter | From [openrouter.ai/keys](https://openrouter.ai/keys) |

### Running Locally

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL (if not using your own)
docker compose up -d postgres

# 3. Push the database schema
pnpm --filter @workspace/db run push

# 4. Start the API server (port 8080)
pnpm --filter @workspace/api-server run dev

# 5. Start the frontend (port 5173) — in a separate terminal
pnpm --filter @workspace/guardduty-analyzer run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Running with Docker

```bash
docker compose up
```

This starts PostgreSQL + runs database migrations automatically. You still need to start the Node.js services manually (or add them to the compose file with your own Dockerfile).

---

## Database

Schema is managed with **Drizzle ORM**. After changing any file in `lib/db/src/schema/`:

```bash
# Push schema to dev database (no migration files generated)
pnpm --filter @workspace/db run push

# Or generate SQL migration files
pnpm --filter @workspace/db run generate
pnpm --filter @workspace/db run migrate
```

### Tables

| Table | Purpose |
|---|---|
| `alerts` | Core alert records from GuardDuty |
| `alert_notes` | Per-alert analyst notes with author |
| `alert_watchers` | Watch subscriptions (userId + alertId) |
| `alert_activity` | Change history events per alert |
| `audit_logs` | Tamper-evident write audit trail |
| `aws_accounts` | Multi-account credential profiles |
| `scheduled_hunts` | Cron-based threat hunt jobs |
| `hunt_notifications` | Results from scheduled hunt runs |

---

## API Reference

The full API contract lives in [`lib/api-spec/openapi.yaml`](lib/api-spec/openapi.yaml).

After editing the spec, regenerate all hooks and schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```

This updates both `lib/api-client-react` (React Query hooks) and `lib/api-zod` (Zod schemas). The server uses these Zod schemas for request validation; the frontend uses the hooks for data fetching.

### Key Endpoints

```
# Alerts
GET    /api/alerts                      List with filters (severity, status, timeframe, account)
POST   /api/alerts                      Ingest + AI-analyze a raw GuardDuty finding
GET    /api/alerts/stats/summary        Dashboard metrics (MTTD, MTTR, velocity, coverage)
GET    /api/alerts/stream               SSE real-time feed
GET    /api/alerts/:id
PUT    /api/alerts/:id/status           Update remediation status (records activity)
DELETE /api/alerts/:id

# Notes & Collaboration
GET    /api/alerts/:id/notes
POST   /api/alerts/:id/notes            Adds note + records activity for watchers
DELETE /api/alerts/:id/notes/:noteId

# Watch & Notifications
GET    /api/alerts/:id/watch?userId=    Check if user is watching
POST   /api/alerts/:id/watch            Subscribe to alert changes
DELETE /api/alerts/:id/watch?userId=    Unsubscribe
GET    /api/alerts/:id/activity         Full change history for one alert
GET    /api/user/notifications?userId=  Activity feed for all watched alerts

# AI & Investigation
POST   /api/aws/investigate             AI deep-dive on a resource
POST   /api/aws/blast-radius            Blast radius analysis
POST   /api/aws/kill-chain              Kill chain reconstruction

# FP Engine
GET    /api/fp-engine/patterns          Extract FP patterns from verdict history
POST   /api/fp-engine/suggest           Score one alert against FP history
GET    /api/fp-engine/auto-suspect      Score all un-triaged alerts
POST   /api/fp-engine/bulk-verdict      Bulk-apply verdict (records activity per alert)

# Threat Hunt
GET    /api/hunt                        Run a natural-language hunt query
GET    /api/hunt/schedules              List scheduled hunts
POST   /api/hunt/schedules              Create a scheduled hunt

# Other
GET    /api/mitre/heatmap
POST   /api/incidents/timeline
GET    /api/accounts
GET    /api/audit
POST   /api/terminal/exec
```

---

## Authentication

GuardAI uses **[Clerk](https://clerk.com)** for authentication. Clerk handles:
- Google SSO
- Email + password
- Session management (JWT, httpOnly cookies)

All `/api` routes except `/api/healthz`, `/api/auth/*`, and the webhook endpoint require a valid Clerk session.

**Setting up Clerk:**

1. Create a free Clerk account at [clerk.com](https://clerk.com)
2. Create a new application
3. Enable Google OAuth in Clerk dashboard → Social Connections
4. Copy your API keys into `.env`:
   - `CLERK_SECRET_KEY=sk_live_...`
   - `VITE_CLERK_PUBLISHABLE_KEY=pk_live_...`

---

## AI Integration

GuardAI supports two AI backends, switchable via `AI_PROVIDER`:

### OpenRouter (recommended for self-hosting)
- Free tier available with open-source models (Llama 3.3 70B)
- Set `AI_PROVIDER=openrouter`
- Get a key at [openrouter.ai/keys](https://openrouter.ai/keys)
- Set `AI_INTEGRATIONS_OPENROUTER_API_KEY=sk-or-...`

### OpenAI GPT-4o
- Best accuracy for complex triage
- Set `AI_PROVIDER=openai`
- Set `OPENAI_API_KEY=sk-...`

Model can be overridden per-deployment with `AI_MODEL=<model-id>`.

---

## AWS Integration

GuardAI can pull live findings directly from your AWS account. The following IAM permissions are required for the service account:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "guardduty:ListFindings",
        "guardduty:GetFindings",
        "guardduty:ListDetectors",
        "ec2:DescribeInstances",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeVpcs",
        "iam:GetUser",
        "iam:ListAttachedUserPolicies",
        "iam:ListAttachedRolePolicies",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "cloudtrail:LookupEvents",
        "logs:FilterLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

Credentials are stored per-account in the `aws_accounts` table and never leave the server.

---

## Deployment

### Deploy on Replit (easiest)
Click **Deploy** in the Replit workspace. Replit auto-provisions a PostgreSQL database, sets up TLS, and exposes a `.replit.app` domain.

### Self-hosting

```bash
# Build everything
pnpm run build

# API server
NODE_ENV=production node artifacts/api-server/dist/index.mjs

# Frontend (static files served from artifacts/guardduty-analyzer/dist)
# Serve with nginx, Caddy, or any static file server
```

The API server expects a reverse proxy to forward `/api` to port 8080. Everything else serves the static frontend build.

**Nginx example:**
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    location /api {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        root /var/www/guardai;
        try_files $uri /index.html;
    }
}
```

---

## Key Commands

```bash
# Full typecheck (all packages)
pnpm run typecheck

# Rebuild lib declarations only
pnpm run typecheck:libs

# Regenerate API hooks + Zod schemas from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Push DB schema to dev database
pnpm --filter @workspace/db run push

# Run a specific package
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/guardduty-analyzer run dev
```

---

## Contributing

1. Fork the repo and create a feature branch
2. Make your changes — all API changes must go through `lib/api-spec/openapi.yaml` first, then run `codegen`
3. Run `pnpm run typecheck` — all packages must pass
4. Open a pull request with a clear description

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">Built with ☕ for security teams who are tired of drowning in GuardDuty noise.</p>
