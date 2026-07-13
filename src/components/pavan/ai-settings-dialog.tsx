"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Eye, EyeOff, Zap, AlertCircle, CheckCircle2, Loader2, Save,
  RotateCcw, Trash2, Server, Shield, Cpu, Coins, Gauge,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useAISettings,
  testProviderConnection,
  type ProviderConfig,
  type ConnectionStatus,
} from "@/lib/ai-settings-store";

const TABS = [
  { id: "providers", label: "Providers & Models", icon: Server },
  { id: "autonomy", label: "Autonomy", icon: Cpu },
  { id: "selfhealing", label: "Self-Healing", icon: Shield },
  { id: "cost", label: "Cost & Budget", icon: Coins },
  { id: "execution", label: "Execution", icon: Gauge },
];

export function AISettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const settings = useAISettings();
  const [saving, setSaving] = useState(false);

  // Load from localStorage on open
  useEffect(() => {
    if (open) {
      settings.load();
      // Auto-test enabled providers silently
      settings.providers.filter((p) => p.enabled).forEach((p) => {
        testProviderConnection(p, () => {});
      });
    }
  }, [open]);

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const result = await settings.saveAll();
      toast.success(
        `AI Settings saved — ${result.connected}/${result.total} connected — avg ${result.avgMs}ms`
      );
      onOpenChange(false);
    } catch (err) {
      toast.error("Validation failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[960px] h-[85vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" /> AI Settings
          </DialogTitle>
          <DialogDescription>
            Configure AI providers (OpenAI & Anthropic compatible), model routing, autonomy,
            self-healing, cost budgets, and execution. Auto-tests connections on change.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={settings.activeTab} onValueChange={settings.setActiveTab} className="flex-1 min-h-0 flex flex-col">
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            {/* Left tabs (desktop vertical, mobile horizontal scroll) */}
            <TabsList className="sm:flex-col sm:w-[200px] sm:h-auto sm:rounded-none sm:border-r sm:border-b-0 border-b border-border bg-muted/30 h-auto p-1 sm:p-2 gap-0.5 shrink-0 overflow-x-auto">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="sm:w-full sm:justify-start gap-2 text-xs sm:text-sm shrink-0"
                  >
                    <Icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{t.label}</span>
                    <span className="sm:hidden">{t.label.split(" ")[0]}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {/* Tab content */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-4 sm:p-6">
                <TabsContent value="providers" className="mt-0">
                  <ProvidersTab />
                </TabsContent>
                <TabsContent value="autonomy" className="mt-0">
                  <AutonomyTab />
                </TabsContent>
                <TabsContent value="selfhealing" className="mt-0">
                  <SelfHealingTab />
                </TabsContent>
                <TabsContent value="cost" className="mt-0">
                  <CostTab />
                </TabsContent>
                <TabsContent value="execution" className="mt-0">
                  <ExecutionTab />
                </TabsContent>
              </div>
            </ScrollArea>
          </div>
        </Tabs>

        <DialogFooter className="px-6 py-3 border-t border-border shrink-0 bg-muted/20">
          <div className="flex items-center justify-between gap-2 w-full">
            <div className="flex items-center gap-2">
              {settings.dirty && (
                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                  Unsaved changes
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground hidden sm:inline">
                Settings stored locally in your browser
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveAll} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save All
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* =================== TAB 1: PROVIDERS =================== */

function ProvidersTab() {
  const providers = useAISettings((s) => s.providers);
  const modelRouter = useAISettings((s) => s.modelRouter);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">OpenAI Compatible</span> and{" "}
          <span className="font-medium text-foreground">Anthropic Compatible</span> providers.
          Configure Base URL, API Key, Model Name. Auto-tests on change.
        </p>
      </div>

      {providers.map((p) => (
        <ProviderCard key={p.id} provider={p} />
      ))}

      {/* Model Router */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Zap className="h-4 w-4" /> Model Router
        </h3>
        <p className="text-[11px] text-muted-foreground mb-3">
          Route agent layers to specific providers + models. Fallback used when primary fails.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Agent Layer</th>
                <th className="px-2 py-1.5 text-left font-medium">Provider</th>
                <th className="px-2 py-1.5 text-left font-medium">Model</th>
                <th className="px-2 py-1.5 text-right font-medium">$/1K in</th>
                <th className="px-2 py-1.5 text-right font-medium">$/1K out</th>
                <th className="px-2 py-1.5 text-left font-medium">Fallback</th>
              </tr>
            </thead>
            <tbody>
              {modelRouter.map((entry) => (
                <ModelRouterRow key={entry.layer} entry={entry} providers={providers} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ModelRouterRow({
  entry,
  providers,
}: {
  entry: import("@/lib/ai-settings-store").ModelRouterEntry;
  providers: ProviderConfig[];
}) {
  const setModelRouter = useAISettings((s) => s.setModelRouter);
  const enabledProviders = providers.filter((p) => p.enabled || p.id === entry.providerId);
  const currentProvider = providers.find((p) => p.id === entry.providerId);

  return (
    <tr className="border-t border-border">
      <td className="px-2 py-1.5 font-medium">{entry.layer}</td>
      <td className="px-2 py-1.5">
        <Select
          value={entry.providerId}
          onValueChange={(v) => {
            const np = providers.find((p) => p.id === v);
            setModelRouter(entry.layer, {
              providerId: v,
              modelName: np?.modelName ?? entry.modelName,
              costPer1kInput: np?.costPer1kInput ?? 0,
              costPer1kOutput: np?.costPer1kOutput ?? 0,
            });
          }}
        >
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {enabledProviders.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-2 py-1.5">
        <Select
          value={entry.modelName}
          onValueChange={(v) => setModelRouter(entry.layer, { modelName: v })}
        >
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(currentProvider?.models ?? []).map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">${entry.costPer1kInput.toFixed(5)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">${entry.costPer1kOutput.toFixed(5)}</td>
      <td className="px-2 py-1.5">
        <Input
          value={entry.fallbackModel ?? ""}
          onChange={(e) => setModelRouter(entry.layer, { fallbackModel: e.target.value })}
          className="h-7 text-xs"
          placeholder="—"
        />
      </td>
    </tr>
  );
}

function ProviderCard({ provider }: { provider: ProviderConfig }) {
  const setProvider = useAISettings((s) => s.setProvider);
  const [showKey, setShowKey] = useState(false);
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const providerRef = useRef(provider);
  useEffect(() => { providerRef.current = provider; }, [provider]);

  // Debounced auto-test — reads from ref to avoid stale closures
  const autoTest = useCallback(() => {
    const p = providerRef.current;
    if (!p.enabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const pp = providerRef.current;
      // Validate
      if (!pp.baseUrl || !/^https?:\/\/.+/.test(pp.baseUrl)) {
        setBaseUrlError("Base URL must start with http:// or https://");
        return;
      }
      setBaseUrlError(null);
      if (!pp.modelName) return;
      if (pp.id !== "ollama" && !pp.apiKey) return;
      testProviderConnection(pp, () => {
        // silent — status dot updates via store
      });
    }, 800);
  }, []);

  // Auto-test on enable
  useEffect(() => {
    if (provider.enabled && provider.status === "idle") {
      autoTest();
    }
  }, [provider.enabled, provider.status, autoTest]);

  const handleTest = () => {
    if (!provider.baseUrl || !/^https?:\/\/.+/.test(provider.baseUrl)) {
      setBaseUrlError("Base URL must start with http:// or https://");
      return;
    }
    setBaseUrlError(null);
    testProviderConnection(provider, (success, latencyMs, error) => {
      if (success) {
        toast.success(`${provider.name}: Connected in ${latencyMs}ms`);
      } else {
        toast.error(`${provider.name}: ${error ?? "Connection failed"}`);
      }
    });
  };

  return (
    <div className={cn(
      "rounded-xl border p-4 transition",
      provider.enabled ? "border-border bg-card" : "border-border/60 bg-muted/20 opacity-70"
    )}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={provider.enabled}
            onCheckedChange={(v) => setProvider(provider.id, { enabled: v })}
          />
          <span className="text-sm font-semibold">{provider.name}</span>
          {provider.apiFormat === "anthropic-compatible" ? (
            <Badge variant="secondary" className="text-[9px] bg-orange-500/10 text-orange-600">Anthropic</Badge>
          ) : (
            <Badge variant="secondary" className="text-[9px] bg-emerald-500/10 text-emerald-600">OpenAI</Badge>
          )}
        </div>
        <StatusDot status={provider.status ?? "idle"} latencyMs={provider.latencyMs} error={provider.lastError} modelName={provider.modelName} />
      </div>

      {/* API Format + API Key row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase text-muted-foreground">API Format</Label>
          <Select
            value={provider.apiFormat}
            onValueChange={(v) => {
              setProvider(provider.id, { apiFormat: v as "openai-compatible" | "anthropic-compatible" });
              autoTest();
            }}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="openai-compatible">OpenAI Compatible</SelectItem>
              <SelectItem value="anthropic-compatible">Anthropic Compatible</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[9px] text-muted-foreground">
            {provider.apiFormat === "anthropic-compatible"
              ? "Uses /messages + x-api-key header"
              : "Uses /chat/completions + Bearer token"}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase text-muted-foreground">API Key</Label>
          <div className="relative">
            <Input
              type={showKey ? "text" : "password"}
              value={provider.apiKey}
              onChange={(e) => setProvider(provider.id, { apiKey: e.target.value })}
              onBlur={() => autoTest()}
              placeholder={provider.id === "ollama" ? "empty for ollama" : "sk-... / sk-ant-..."}
              className="h-8 text-xs pr-8 font-mono"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              type="button"
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="text-[9px] text-muted-foreground">Stored locally only (base64)</p>
        </div>
      </div>

      {/* Base URL + Model Name grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Base URL</Label>
          <Input
            value={provider.baseUrl}
            onChange={(e) => setProvider(provider.id, { baseUrl: e.target.value })}
            onBlur={() => autoTest()}
            className={cn("h-8 text-xs font-mono", baseUrlError && "border-red-500")}
            placeholder="https://api.example.com/v1"
          />
          {baseUrlError && (
            <p className="text-[9px] text-red-500">{baseUrlError}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Model Name</Label>
          <Select
            value={provider.modelName}
            onValueChange={(v) => {
              setProvider(provider.id, { modelName: v });
              autoTest();
            }}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(provider.models ?? []).map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Test button */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={provider.status === "testing" || !provider.enabled}
        className="h-7 text-xs gap-1.5"
      >
        {provider.status === "testing" ? (
          <><Loader2 className="h-3 w-3 animate-spin" /> Testing…</>
        ) : (
          <><Zap className="h-3 w-3" /> Test Connection</>
        )}
      </Button>
    </div>
  );
}

function StatusDot({
  status,
  latencyMs,
  error,
  modelName,
}: {
  status: ConnectionStatus;
  latencyMs?: number;
  error?: string;
  modelName?: string;
}) {
  if (status === "idle") {
    return <span className="h-2.5 w-2.5 rounded-full bg-zinc-400" title="Idle" />;
  }
  if (status === "testing") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" title="Testing…" />;
  }
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-600">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        Connected {latencyMs}ms
      </span>
    );
  }
  // failed
  return (
    <span className="flex items-center gap-1 text-[10px] text-red-500" title={error}>
      <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
      {error ? error.slice(0, 40) : "Failed"}
    </span>
  );
}

/* =================== TAB 2: AUTONOMY =================== */

function AutonomyTab() {
  const autonomy = useAISettings((s) => s.autonomy);
  const setAutonomy = useAISettings((s) => s.setAutonomy);

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-xs font-medium">Ambiguity Threshold: {autonomy.ambiguityThreshold.toFixed(2)}</Label>
        <Slider
          value={[autonomy.ambiguityThreshold]}
          onValueChange={(v) => setAutonomy({ ambiguityThreshold: v[0] })}
          min={0}
          max={1}
          step={0.05}
          className="py-2"
        />
        <p className="text-[10px] text-muted-foreground">
          Prompts scoring above this are flagged for clarification. Example: "Build app" → score 0.80 → asks "What kind of app?"
        </p>
      </div>

      <ToggleRow
        label="Allow questions"
        description="When ambiguity is high, ask the user instead of guessing."
        checked={autonomy.allowQuestions}
        onCheckedChange={(v) => setAutonomy({ allowQuestions: v })}
      />

      <ToggleRow
        label="Auto-proceed when clear"
        description="When requirements are clear, build immediately without confirmation."
        checked={autonomy.autoProceed}
        onCheckedChange={(v) => setAutonomy({ autoProceed: v })}
      />

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium">Decision Confidence Level</Label>
        <Select
          value={autonomy.confidenceLevel}
          onValueChange={(v) => setAutonomy({ confidenceLevel: v as "low" | "medium" | "high" })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low (60%) — proceed unless very ambiguous</SelectItem>
            <SelectItem value="medium">Medium (80%) — standard threshold</SelectItem>
            <SelectItem value="high">High (90%) — only proceed when very confident</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium">Max Retries (self-healing)</Label>
        <Input
          type="number"
          value={autonomy.maxRetries}
          onChange={(e) => setAutonomy({ maxRetries: parseInt(e.target.value, 10) || 0 })}
          className="h-8 text-xs"
          min={0}
          max={10}
        />
        <p className="text-[10px] text-muted-foreground">Maximum self-healing attempts before escalating to HumanQuestion.</p>
      </div>
    </div>
  );
}

/* =================== TAB 3: SELF-HEALING =================== */

function SelfHealingTab() {
  const sh = useAISettings((s) => s.selfHealing);
  const setSH = useAISettings((s) => s.setSelfHealing);

  const levels = [
    { id: "fastfix", label: "Fast Fix" },
    { id: "incremental-patch", label: "Incremental Patch" },
    { id: "module-rewrite", label: "Module Rewrite" },
    { id: "architecture-reevaluation", label: "Architecture Reevaluation" },
    { id: "human-question", label: "Human Question" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Retry Limits per Level</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {levels.map((lvl) => (
            <div key={lvl.id} className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase text-muted-foreground">{lvl.label}</Label>
              <Input
                type="number"
                value={sh.retryLimits[lvl.id] ?? 0}
                onChange={(e) =>
                  setSH({ retryLimits: { ...sh.retryLimits, [lvl.id]: parseInt(e.target.value, 10) || 0 } })
                }
                className="h-8 text-xs"
                min={0}
                max={10}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium">Escalation Threshold: {sh.escalationThreshold}</Label>
        <Slider
          value={[sh.escalationThreshold]}
          onValueChange={(v) => setSH({ escalationThreshold: v[0] })}
          min={1}
          max={10}
          step={1}
          className="py-2"
        />
        <p className="text-[10px] text-muted-foreground">Failures at a level before escalating to the next.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium">Patch Strategy</Label>
        <Select
          value={sh.patchStrategy}
          onValueChange={(v) => setSH({ patchStrategy: v as "minimal-diff" | "module-rewrite" })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="minimal-diff">Minimal Diff — smallest possible change</SelectItem>
            <SelectItem value="module-rewrite">Module Rewrite — regenerate the whole file</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium">Rollback Behavior</Label>
        <Select
          value={sh.rollbackBehavior}
          onValueChange={(v) => setSH({ rollbackBehavior: v as "auto" | "manual" })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto rollback on regression</SelectItem>
            <SelectItem value="manual">Manual rollback (ask user)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          setSH({
            retryLimits: { fastfix: 3, "incremental-patch": 2, "module-rewrite": 1, "architecture-reevaluation": 1, "human-question": 0 },
            escalationThreshold: 3,
            patchStrategy: "minimal-diff",
            rollbackBehavior: "auto",
          })
        }
        className="gap-1.5 h-8 text-xs"
      >
        <RotateCcw className="h-3 w-3" /> Reset to Defaults
      </Button>
    </div>
  );
}

/* =================== TAB 4: COST & BUDGET =================== */

function CostTab() {
  const cost = useAISettings((s) => s.cost);
  const setCost = useAISettings((s) => s.setCost);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Monthly Budget ($)</Label>
          <Input
            type="number"
            value={cost.monthlyBudget}
            onChange={(e) => setCost({ monthlyBudget: parseFloat(e.target.value) || 0 })}
            className="h-8 text-xs"
            step="1"
            min="0"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Daily Limit ($)</Label>
          <Input
            type="number"
            value={cost.dailyLimit}
            onChange={(e) => setCost({ dailyLimit: parseFloat(e.target.value) || 0 })}
            className="h-8 text-xs"
            step="0.5"
            min="0"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Per-Task Limit ($)</Label>
          <Input
            type="number"
            value={cost.perTaskLimit}
            onChange={(e) => setCost({ perTaskLimit: parseFloat(e.target.value) || 0 })}
            className="h-8 text-xs"
            step="0.1"
            min="0"
          />
        </div>
      </div>

      <ToggleRow
        label="Pause when exceeded"
        description="Halt the pipeline when the budget is exceeded."
        checked={cost.pauseWhenExceeded}
        onCheckedChange={(v) => setCost({ pauseWhenExceeded: v })}
      />

      <ToggleRow
        label="Use cheaper fallback"
        description="When a task's cost exceeds its limit, fall back to a cheaper model."
        checked={cost.useCheaperFallback}
        onCheckedChange={(v) => setCost({ useCheaperFallback: v })}
      />

      <Button
        variant="outline"
        size="sm"
        onClick={() => toast.success("Cost history cleared")}
        className="gap-1.5 h-8 text-xs"
      >
        <Trash2 className="h-3 w-3" /> Clear History
      </Button>
    </div>
  );
}

/* =================== TAB 5: EXECUTION =================== */

function ExecutionTab() {
  const exec = useAISettings((s) => s.execution);
  const setExec = useAISettings((s) => s.setExecution);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium">Tool Mode</Label>
        <Select
          value={exec.toolMode}
          onValueChange={(v) => setExec({ toolMode: v as "local-node" | "tauri-shell" | "docker" })}
        >
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="local-node">Local Node — child_process.spawn</SelectItem>
            <SelectItem value="tauri-shell">Tauri Shell — @tauri-apps/api/shell</SelectItem>
            <SelectItem value="docker">Docker — containerized builds</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ToggleRow
        label="Offline mode"
        description="Warn when no local model provider (Ollama) is enabled."
        checked={exec.offlineMode}
        onCheckedChange={(v) => setExec({ offlineMode: v })}
      />
      {exec.offlineMode && (
        <p className="text-[10px] text-amber-600 -mt-3">
          ⚠ Enable Ollama in the Providers tab for offline operation.
        </p>
      )}

      <ToggleRow
        label="Allow FS writes outside workspace"
        description="Permit file writes outside /tmp/pavan (not recommended)."
        checked={exec.allowFsWritesOutside}
        onCheckedChange={(v) => setExec({ allowFsWritesOutside: v })}
      />

      <div className="flex flex-col gap-1">
        <Label className="text-[10px] uppercase text-muted-foreground">Workspace Root</Label>
        <Input
          value={exec.workspaceRoot}
          onChange={(e) => setExec({ workspaceRoot: e.target.value })}
          className="h-8 text-xs font-mono"
        />
      </div>

      <ToggleRow
        label="Auto checkpoints"
        description="Save IndexedDB checkpoints after each stage for crash recovery."
        checked={exec.autoCheckpoints}
        onCheckedChange={(v) => setExec({ autoCheckpoints: v })}
      />

      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          if (typeof window !== "undefined" && "indexedDB" in window) {
            indexedDB.deleteDatabase("pavan-engine");
            toast.success("IndexedDB cleared");
          }
        }}
        className="gap-1.5 h-8 text-xs"
      >
        <Trash2 className="h-3 w-3" /> Clear IndexedDB
      </Button>
    </div>
  );
}

/* =================== Shared ToggleRow =================== */

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-[10px] text-muted-foreground">{description}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
