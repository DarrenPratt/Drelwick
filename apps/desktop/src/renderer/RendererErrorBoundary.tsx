import { Component, Fragment, type ReactNode } from "react";
import { RendererErrorNameSchema } from "@drelwick/shared";

interface RendererErrorBoundaryProps {
  children?: ReactNode;
  preserveWorkspaceState?: boolean;
}

interface RendererErrorBoundaryState {
  failed: boolean;
  retryKey: number;
}

/** Replaces failed renderer subtrees without displaying or reporting error text. */
export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  override state: RendererErrorBoundaryState = {
    failed: false,
    retryKey: 0,
  };

  static getDerivedStateFromError(): Partial<RendererErrorBoundaryState> {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    const parsedName = RendererErrorNameSchema.safeParse(error.name);
    const errorName = parsedName.success ? parsedName.data : "UnknownError";
    try {
      void window.drelwick.reportRendererError({ errorName }).catch(() => {
        // The fallback must remain usable when diagnostic reporting is unavailable.
      });
    } catch {
      // A mismatched or unavailable preload must not replace the fallback.
    }
  }

  private readonly retry = () => {
    this.setState(({ retryKey }) => ({
      failed: false,
      retryKey: retryKey + 1,
    }));
  };

  override render(): ReactNode {
    if (this.state.failed)
      return (
        <main className="renderer-error-screen" role="alert">
          <section>
            <p className="eyebrow">Drelwick</p>
            <h1>This part of the editor stopped unexpectedly.</h1>
            <p>
              {this.props.preserveWorkspaceState
                ? "Your project files were not changed, and unsaved edits remain in this window. Try the interface again, then save your chapter."
                : "Saved project files were not changed. Try the interface again. If the problem returns, restart Drelwick to run recovery checks."}
            </p>
            <button className="primary-button" onClick={this.retry}>
              Try interface again
            </button>
          </section>
        </main>
      );

    return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>;
  }
}
