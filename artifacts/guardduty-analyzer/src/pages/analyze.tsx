import { useState } from "react";
import { useAnalyzeAlert } from "@workspace/api-client-react";
import { Shield, FileJson, AlertTriangle, CheckCircle, Terminal, FileCode, Play, Copy, Loader2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { clsx } from "clsx";

export function Analyze() {
  const [alertJson, setAlertJson] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const analyzeMutation = useAnalyzeAlert();

  const handleAnalyze = () => {
    if (!alertJson.trim()) {
      toast({
        title: "Input required",
        description: "Please paste a valid GuardDuty alert JSON.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Validate it's JSON
      JSON.parse(alertJson);
      
      analyzeMutation.mutate(
        { data: { alertJson } },
        {
          onSuccess: (alert) => {
            toast({
              title: "Analysis Complete",
              description: `Alert mapped to ${alert.mitreAttackTactic}`,
            });
            setLocation(`/alerts/${alert.id}`);
          },
          onError: (error) => {
            toast({
              title: "Analysis Failed",
              description: error?.message || "Failed to analyze alert. Please try again.",
              variant: "destructive",
            });
          },
        }
      );
    } catch (e) {
      toast({
        title: "Invalid JSON",
        description: "The provided input is not valid JSON.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Alert Analyzer</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">Paste raw GuardDuty JSON to extract MITRE mappings and generate remediation code.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Input Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center">
              <FileJson className="w-5 h-5 mr-2 text-primary" />
              Raw Alert Payload
            </h2>
            <button
              onClick={() => setAlertJson('{\n  "schemaVersion": "2.0",\n  "accountId": "123456789012",\n  "region": "us-east-1",\n  "partition": "aws",\n  "id": "12345678901234567890123456789012",\n  "arn": "arn:aws:guardduty:us-east-1:123456789012:detector/12345678901234567890123456789012/finding/12345678901234567890123456789012",\n  "type": "UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS",\n  "resource": {\n    "resourceType": "Instance",\n    "instanceDetails": {\n      "instanceId": "i-99999999"\n    }\n  },\n  "severity": 8.0,\n  "title": "Credentials for the IAM role attached to instance i-99999999 are being used from an external IP address."\n}')}
              className="text-xs text-muted-foreground hover:text-primary font-mono transition-colors"
            >
              Load Sample
            </button>
          </div>
          
          <div className="relative rounded-lg border border-border bg-card overflow-hidden focus-within:ring-1 focus-within:ring-primary transition-shadow h-[400px]">
            <div className="absolute top-0 left-0 bottom-0 w-10 bg-secondary/50 border-r border-border flex flex-col items-center py-4 space-y-1 text-xs text-muted-foreground font-mono select-none pointer-events-none">
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              className="w-full h-full bg-transparent border-0 resize-none p-4 pl-14 font-mono text-sm focus:ring-0 focus:outline-none"
              placeholder="Paste JSON here..."
              value={alertJson}
              onChange={(e) => setAlertJson(e.target.value)}
              spellCheck={false}
            />
          </div>

          <button
            onClick={handleAnalyze}
            disabled={analyzeMutation.isPending || !alertJson.trim()}
            className={clsx(
              "w-full py-3 px-4 rounded-md font-bold text-sm tracking-wide uppercase transition-all flex items-center justify-center space-x-2",
              analyzeMutation.isPending 
                ? "bg-secondary text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {analyzeMutation.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Analyzing Payload...</span>
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                <span>Run Analysis</span>
              </>
            )}
          </button>
        </div>

        {/* Expected Output Preview */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center text-muted-foreground">
            <Terminal className="w-5 h-5 mr-2" />
            Analysis Pipeline
          </h2>
          
          <div className="space-y-4 relative before:absolute before:inset-0 before:ml-[1.4rem] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
            <PipelineStep 
              number={1} 
              title="Parse & Validate" 
              desc="Extracts resource ARNs, region, severity, and exact finding type." 
              active={analyzeMutation.isPending}
            />
            <PipelineStep 
              number={2} 
              title="MITRE ATT&CK Mapping" 
              desc="Aligns finding with specific tactics, techniques, and ID codes." 
              active={analyzeMutation.isPending}
            />
            <PipelineStep 
              number={3} 
              title="Remediation Strategy" 
              desc="Determines the exact API calls needed to isolate the threat." 
              active={analyzeMutation.isPending}
            />
            <PipelineStep 
              number={4} 
              title="Boto3 Generation" 
              desc="Writes precise Python script for automated containment." 
              active={analyzeMutation.isPending}
            />
          </div>

          <div className="mt-8 bg-secondary/20 border border-secondary rounded-lg p-6">
            <h3 className="font-mono text-sm font-semibold mb-2 flex items-center text-muted-foreground">
              <Shield className="w-4 h-4 mr-2" /> Security Notice
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Automated remediation scripts are generated for containment purposes only. 
              Review all generated code before execution. Sentinel does not automatically apply 
              changes to your AWS environment unless explicitly configured.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineStep({ number, title, desc, active }: { number: number, title: string, desc: string, active: boolean }) {
  return (
    <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
      <div className="flex items-center justify-center w-8 h-8 rounded-full border border-border bg-card shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 transition-colors duration-300">
        <span className={clsx("font-mono text-xs", active ? "text-primary animate-pulse" : "text-muted-foreground")}>{number}</span>
      </div>
      
      <div className="w-[calc(100%-3rem)] md:w-[calc(50%-1.5rem)] bg-card border border-border p-4 rounded-lg shadow-sm">
        <div className="flex items-center mb-1">
          <h4 className={clsx("font-bold text-sm", active ? "text-primary" : "text-foreground")}>{title}</h4>
        </div>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}
