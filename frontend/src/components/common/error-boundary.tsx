import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VeloRayMark } from "@/components/brand/veloray-mark";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error.message : "Unexpected UI error",
    };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("VeloRay UI error", error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--bg)] p-5 text-[var(--fg)]">
        <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--card-shadow)]">
          <div className="flex items-center gap-3">
            <VeloRayMark className="h-9 w-9" />
            <div>
              <div className="text-[14px] font-semibold">
                This page could not load
              </div>
              <div className="mt-0.5 text-[10px] text-[var(--muted)]">
                Reload the panel to try again.
              </div>
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/8 p-4">
            <div className="flex items-start gap-2 text-[12px] text-red-500">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{this.state.error}</span>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <Button className="flex-1" onClick={() => location.reload()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Reload panel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                history.replaceState({}, "", "/dashboard");
                location.reload();
              }}
            >
              Go to overview
            </Button>
          </div>
        </div>
      </main>
    );
  }
}
