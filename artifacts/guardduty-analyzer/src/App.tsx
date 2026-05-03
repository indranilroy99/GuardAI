import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";
import { GlobalFiltersProvider } from "@/lib/global-filters-context";
import { ClerkProvider, SignIn, SignUp, useAuth as useClerkAuth } from "@clerk/react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { useEffect } from "react";
import { Layout } from "./components/layout";
import { Dashboard } from "./pages/dashboard";
import { Analyze } from "./pages/analyze";
import { Alerts } from "./pages/alerts";
import { AlertDetail } from "./pages/alert-detail";
import { AwsConnect } from "./pages/aws";
import { Agents } from "./pages/agents";
import { AuditLog } from "./pages/audit";
import { Integrations } from "./pages/integrations";
import { TerminalPage } from "./pages/terminal";
import { Accounts } from "./pages/accounts";
import { Incidents } from "./pages/incidents";
import { Onboarding } from "./pages/onboarding";
import { ThreatHunt } from "./pages/hunt";
import { MitreHeatmap } from "./pages/mitre";
import { FpEngine } from "./pages/fp-engine";
import { Notifications } from "./pages/notifications";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        // Allow up to 2 retries for auth errors — Clerk session cookie may not
        // be set on the very first render. Stop after 2 failures.
        if ((error as { status?: number })?.status === 401) return failureCount < 2;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 5000),
    },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL || undefined;

// AWS console colour palette for Clerk
const clerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "#ff9900",
    colorForeground: "#e2e8f0",
    colorMutedForeground: "#7f9ab0",
    colorDanger: "#f14c4c",
    colorBackground: "#141f2e",
    colorInput: "#0f1923",
    colorInputForeground: "#e2e8f0",
    colorNeutral: "#1f2f40",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "2px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "border border-[#1f2f40] overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-[#0f1923] !rounded-none",
    headerTitle: "text-[#e2e8f0] font-semibold",
    headerSubtitle: "text-[#7f9ab0]",
    formFieldLabel: "text-[10px] tracking-widest text-[#7f9ab0] uppercase font-mono",
    footerActionLink: "!text-[#ff9900] hover:!text-[#ff9900]/80",
    footerActionText: "text-[#415161]",
    dividerText: "text-[#415161] text-[11px]",
    formButtonPrimary: "!bg-[#ff9900] hover:!bg-[#e68a00] !text-black font-bold !shadow-none",
    formFieldInput: "!bg-[#0f1923] !border-[#1f2f40] !text-[#e2e8f0] focus:!border-[#ff9900] !rounded-none",
    socialButtonsBlockButton: "!bg-[#141f2e] !border !border-[#1f2f40] hover:!bg-[#1a2535] !rounded-none",
    socialButtonsBlockButtonText: "text-[#e2e8f0] text-[12px]",
    dividerRow: "my-4",
    alertText: "text-[#f14c4c] text-[12px]",
    identityPreviewEditButton: "text-[#ff9900]",
    formFieldSuccessText: "text-[#1db954]",
  },
};

function LoadingScreen() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center" style={{ background: "#0f1923" }}>
      <div className="flex flex-col items-center gap-4">
        <svg viewBox="0 0 28 28" fill="none" className="w-10 h-10 animate-pulse">
          <path d="M14 1.5L25 6.8V15.5C25 21.4 20.1 25.6 14 27.5C7.9 25.6 3 21.4 3 15.5V6.8L14 1.5Z" fill="#0f1923" stroke="#ff9900" strokeWidth="1.4" />
          <circle cx="14" cy="14" r="4" stroke="#ff9900" strokeWidth="1.2" fill="none" />
          <circle cx="14" cy="14" r="1.5" fill="#ff9900" />
        </svg>
        <span className="font-mono text-[10px] tracking-[0.2em]" style={{ color: "#415161" }}>INITIALIZING…</span>
      </div>
    </div>
  );
}

function LandingPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen w-full flex" style={{ background: "#0a1218" }}>
      {/* Left panel */}
      <div className="flex-1 flex flex-col justify-between p-12 relative overflow-hidden" style={{ borderRight: "1px solid #1a2535" }}>
        {/* Subtle grid */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: "linear-gradient(#1a2535 1px, transparent 1px), linear-gradient(90deg, #1a2535 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          opacity: 0.18,
        }} />
        {/* Orange glow top-left */}
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: "#ff9900", opacity: 0.04, filter: "blur(100px)" }} />

        {/* Wordmark */}
        <div className="relative z-10 flex items-center gap-3">
          <svg viewBox="0 0 28 28" fill="none" className="w-7 h-7">
            <path d="M14 1.5L25 6.8V15.5C25 21.4 20.1 25.6 14 27.5C7.9 25.6 3 21.4 3 15.5V6.8L14 1.5Z" fill="#0a1218" stroke="#ff9900" strokeWidth="1.4" />
            <path d="M14 14 Q17 10 20 14" stroke="#ff9900" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
            <circle cx="14" cy="14" r="1.5" fill="#ff9900" />
            <line x1="14" y1="14" x2="20" y2="10" stroke="#ff9900" strokeWidth="1" strokeLinecap="round" opacity="0.8" />
          </svg>
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-[15px] tracking-wide" style={{ color: "#ff9900" }}>GuardAI</span>
            <span className="text-[9px] tracking-[0.08em]" style={{ color: "#415161" }}>v2.0</span>
          </div>
          <div className="h-4 w-px mx-1" style={{ background: "#1f2f40" }} />
          <span className="text-[9px] tracking-[0.1em]" style={{ color: "#415161" }}>AWS SECURITY OPERATIONS</span>
        </div>

        {/* Hero */}
        <div className="relative z-10 max-w-[480px]">
          <h1 className="text-[42px] font-bold leading-[1.08] tracking-[-0.02em]" style={{ color: "#e2e8f0" }}>
            GuardDuty findings,<br />
            <span style={{ color: "#ff9900" }}>triaged in seconds.</span>
          </h1>
          <p className="mt-4 text-[14px] leading-[1.7] font-light" style={{ color: "#415161" }}>
            AI-powered alert analysis, MITRE ATT&CK classification, and automated remediation — built for AWS security teams.
          </p>
        </div>

        <div />
      </div>

      {/* Right panel — auth */}
      <div className="w-[380px] flex-shrink-0 flex flex-col justify-center px-12 py-16" style={{ background: "#0f1923" }}>
        <div className="mb-8">
          <h2 className="text-[20px] font-bold tracking-tight leading-snug" style={{ color: "#e2e8f0" }}>
            Sign in
          </h2>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => setLocation("/sign-in")}
            className="w-full py-3 font-bold text-[12px] tracking-[0.1em] transition-colors"
            style={{ background: "#ff9900", color: "#000" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#e68a00")}
            onMouseLeave={e => (e.currentTarget.style.background = "#ff9900")}
          >
            SIGN IN
          </button>
          <button
            onClick={() => setLocation("/sign-up")}
            className="w-full py-3 text-[12px] tracking-[0.1em] transition-colors"
            style={{ background: "transparent", border: "1px solid #1f2f40", color: "#7f9ab0" }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "#2a3f54")}
            onMouseLeave={e => (e.currentTarget.style.borderColor = "#1f2f40")}
          >
            CREATE ACCOUNT
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a1218" }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "linear-gradient(#1a2535 1px, transparent 1px), linear-gradient(90deg, #1a2535 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        opacity: 0.15,
      }} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function SignInPage() {
  return (
    <AuthPageShell>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} fallbackRedirectUrl={`${basePath}/`} appearance={clerkAppearance} />
    </AuthPageShell>
  );
}

function SignUpPage() {
  return (
    <AuthPageShell>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} fallbackRedirectUrl={`${basePath}/`} appearance={clerkAppearance} />
    </AuthPageShell>
  );
}

function AppRouter() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!user) return <LandingPage />;
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/analyze" component={Analyze} />
        <Route path="/alerts" component={Alerts} />
        <Route path="/alerts/:id" component={AlertDetail} />
        <Route path="/aws" component={AwsConnect} />
        <Route path="/agents" component={Agents} />
        <Route path="/audit" component={AuditLog} />
        <Route path="/integrations" component={Integrations} />
        <Route path="/terminal" component={TerminalPage} />
        <Route path="/accounts" component={Accounts} />
        <Route path="/incidents" component={Incidents} />
        <Route path="/setup" component={Onboarding} />
        <Route path="/hunt" component={ThreatHunt} />
        <Route path="/mitre" component={MitreHeatmap} />
        <Route path="/fp-engine" component={FpEngine} />
        <Route path="/notifications" component={Notifications} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

/**
 * Registers Clerk's session JWT as the Bearer token for every API fetch.
 * This works in all environments (dev, prod, iframes) regardless of whether
 * the __session cookie is present. Must be mounted inside ClerkProvider.
 */
function ClerkTokenBridge() {
  const { getToken, isSignedIn } = useClerkAuth();
  useEffect(() => {
    if (isSignedIn) {
      setAuthTokenGetter(() => getToken());
    } else {
      setAuthTokenGetter(null);
    }
    return () => { setAuthTokenGetter(null); };
  }, [isSignedIn, getToken]);
  return null;
}

function ClerkWithRouter({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      proxyUrl={clerkProxyUrl}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to))}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      appearance={clerkAppearance}
    >
      <ClerkTokenBridge />
      {children}
    </ClerkProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <GlobalFiltersProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={basePath}>
              <ClerkWithRouter>
                <AuthProvider>
                  <Switch>
                    <Route path="/sign-in" component={SignInPage} />
                    <Route path="/sign-in/*" component={SignInPage} />
                    <Route path="/sign-up" component={SignUpPage} />
                    <Route path="/sign-up/*" component={SignUpPage} />
                    <Route component={AppRouter} />
                  </Switch>
                  <Toaster />
                </AuthProvider>
              </ClerkWithRouter>
            </WouterRouter>
          </TooltipProvider>
        </QueryClientProvider>
      </GlobalFiltersProvider>
    </ThemeProvider>
  );
}

export default App;
