"use client";

import { useState } from "react";
import { useApp } from "@/lib/store";
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
import { Folder, Loader2, CheckCircle2, Download, Info } from "lucide-react";
import { toast } from "sonner";

export function ExportDialog() {
  const open = useApp((s) => s.exportOpen);
  const setOpen = useApp((s) => s.setExportOpen);
  const exportProject = useApp((s) => s.exportProject);
  const activeProjectId = useApp((s) => s.activeProjectId);
  const projects = useApp((s) => s.projects);
  const active = projects.find((p) => p.id === activeProjectId) ?? projects[0];

  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ message: string } | null>(null);

  const defaultPath = active
    ? `~/PavanExports/${active.name.replace(/[^a-zA-Z0-9]/g, "")}`
    : "~/PavanExports/MyApp";

  const handleExport = async () => {
    setBusy(true);
    setDone(null);
    const target = path.trim() || defaultPath;
    const res = await exportProject(target);
    setBusy(false);
    if (res.ok) {
      setDone({ message: res.message });
      toast.success("Export complete", { description: res.message });
    } else {
      toast.error("Export failed", { description: res.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setDone(null); setBusy(false); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Folder className="h-4 w-4" /> Export to Folder
          </DialogTitle>
          <DialogDescription>
            Export the complete versioned solution to a local folder. Pavan copies{" "}
            <code className="text-[10px]">/backend</code>{" "}
            <code className="text-[10px]">/desktop</code>{" "}
            <code className="text-[10px]">/android</code>{" "}
            <code className="text-[10px]">/web-admin</code>{" "}
            <code className="text-[10px]">/docs</code>{" "}
            <code className="text-[10px]">/artifacts</code> and{" "}
            <code className="text-[10px]">DecisionLog.json</code>. Works offline.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Export path</Label>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={defaultPath}
              className="text-xs font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              Leave blank to use the default. Your browser will ask for folder permission, or
              download a .zip if folder access isn't supported.
            </p>
          </div>

          {done && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <span className="text-[11px] text-emerald-700 dark:text-emerald-300">{done.message}</span>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <span className="text-[10px] text-muted-foreground">
              The Export Manager (Porter) runs the Export Project workflow: validate path →
              bundle from Artifact Registry → write. Tauri bundler produces NSIS .exe + MSI;
              web fallback uses the File System Access API or a .zip download.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button onClick={handleExport} disabled={busy || !active}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Exporting…
              </>
            ) : (
              <>
                <Download className="h-4 w-4" /> Export
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
