#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
# GuardAI — Self-Hosted Setup Script
#
# Usage:
#   chmod +x setup.sh && ./setup.sh
#
# Requires: node 20+, pnpm, docker (optional for DB), psql
# ══════════════════════════════════════════════════════════════

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

header() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
ok() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
err() { echo -e "${RED}✗${NC} $1"; exit 1; }

echo -e "${CYAN}"
cat << 'EOF'
  ███████╗███████╗███╗   ██╗████████╗██╗███╗   ██╗███████╗██╗     
  ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██║████╗  ██║██╔════╝██║     
  ███████╗█████╗  ██╔██╗ ██║   ██║   ██║██╔██╗ ██║█████╗  ██║     
  ╚════██║██╔══╝  ██║╚██╗██║   ██║   ██║██║╚██╗██║██╔══╝  ██║     
  ███████║███████╗██║ ╚████║   ██║   ██║██║ ╚████║███████╗███████╗ 
  ╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝ XDR
EOF
echo -e "${NC}"

# ─── Prerequisites ────────────────────────────────────────────────────────────
header "Checking prerequisites"

command -v node &>/dev/null || err "Node.js not found. Install from https://nodejs.org (v20+)"
NODE_VER=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
[ "$NODE_VER" -ge 20 ] || err "Node.js 20+ required (found v$NODE_VER)"
ok "Node.js v$(node -e 'process.stdout.write(process.version)')"

command -v pnpm &>/dev/null || (warn "pnpm not found. Installing..." && npm install -g pnpm)
ok "pnpm $(pnpm --version)"

# ─── Dependencies ─────────────────────────────────────────────────────────────
header "Installing dependencies"
pnpm install --no-frozen-lockfile
ok "Dependencies installed"

# ─── Environment ──────────────────────────────────────────────────────────────
header "Environment setup"

if [ ! -f .env ]; then
  cp .env.example .env
  warn "Created .env from .env.example — please fill in the values below"
else
  ok ".env already exists"
fi

echo ""
echo -e "${YELLOW}Required environment variables:${NC}"
echo ""
echo "  DATABASE_URL        — PostgreSQL connection string"
echo "  SESSION_SECRET      — Random 64-char string (run: openssl rand -hex 64)"
echo "  CLERK_SECRET_KEY    — From https://dashboard.clerk.com (production keys)"
echo "  VITE_CLERK_PUBLISHABLE_KEY — From Clerk dashboard"
echo ""
echo -e "${CYAN}AI Provider (choose one):${NC}"
echo ""
echo "  Option A — OpenRouter (FREE open-source Llama 3.3):"
echo "    AI_PROVIDER=openrouter"
echo "    AI_MODEL=meta-llama/llama-3.3-70b-instruct:free"
echo "    AI_INTEGRATIONS_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1"
echo "    AI_INTEGRATIONS_OPENROUTER_API_KEY=<from https://openrouter.ai/keys>"
echo ""
echo "  Option B — OpenAI GPT-4o (highest accuracy):"
echo "    AI_PROVIDER=openai"
echo "    AI_MODEL=gpt-4o"
echo "    OPENAI_API_KEY=sk-..."
echo ""

read -p "Press ENTER when .env is configured to continue..." _

# ─── Load env ─────────────────────────────────────────────────────────────────
set -a; source .env; set +a

# ─── Database ─────────────────────────────────────────────────────────────────
header "Database setup"

if [ -z "$DATABASE_URL" ]; then
  err "DATABASE_URL is not set in .env"
fi

echo "Testing database connection..."
if node -e "const { Client } = require('pg'); const c = new Client({ connectionString: process.env.DATABASE_URL }); c.connect().then(() => { console.log('Connected'); c.end(); }).catch(e => { console.error(e.message); process.exit(1); })" 2>&1; then
  ok "Database connection successful"
else
  warn "Could not connect to database. Make sure PostgreSQL is running."
  echo "  Start with Docker: docker run -d -e POSTGRES_DB=sentinel -e POSTGRES_USER=sentinel -e POSTGRES_PASSWORD=sentinel -p 5432:5432 postgres:16-alpine"
  echo "  Then set: DATABASE_URL=postgres://sentinel:sentinel@localhost:5432/sentinel"
  read -p "Press ENTER once database is ready..." _
fi

echo "Running migrations..."
cd lib/db && pnpm exec drizzle-kit push && cd ../..
ok "Database schema applied"

# ─── Build ────────────────────────────────────────────────────────────────────
header "Building"

pnpm run typecheck:libs
ok "Type checking passed"

# Build API server
pnpm --filter @workspace/api-server run build
ok "API server built"

# Build frontend
pnpm --filter @workspace/guardduty-analyzer run build
ok "Frontend built"

# ─── Done ─────────────────────────────────────────────────────────────────────
header "Setup complete"

echo ""
echo -e "${GREEN}GuardAI is ready!${NC}"
echo ""
echo "Start the application:"
echo ""
echo "  # API server (port 8080)"
echo "  pnpm --filter @workspace/api-server run start"
echo ""
echo "  # Serve the frontend build"
echo "  npx serve artifacts/guardduty-analyzer/dist --single --listen 3000"
echo ""
echo "  # Or use docker-compose for everything:"
echo "  docker-compose up -d"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo "  1. Open http://localhost:3000 → Setup Guide"
echo "  2. Get your webhook token from Integrations page"
echo "  3. Configure EventBridge (follow Setup Guide → Step 2)"
echo "  4. Send a test alert to verify the pipeline"
echo ""
