import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { TulipMark } from "./ui";
import { Button } from "./Button";

/**
 * A request that failed, with a way out of it.
 *
 * Home, Shop, Brands and the audience pages all destructured `error` from `useFetch` and then
 * ignored it, so a 500 or a dropped connection rendered "Nothing here yet" — telling a shopper
 * the catalogue is empty when in fact nothing was ever loaded. That is the same class of
 * problem as a promo advertising a discount that doesn't exist: the page states something
 * untrue with complete confidence.
 *
 * The server's message is shown when it sent one, because "This coupon has expired" is more
 * use than "Something went wrong". `detail` is never a stack trace.
 */
export function ErrorState({
  title = "We couldn’t load this",
  detail,
  onRetry,
  compact = false,
}: {
  title?: string;
  detail?: string | null;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div role="alert" className={`grid place-items-center rounded-2xl border border-dashed border-line-strong text-center ${compact ? "py-10" : "py-20"}`}>
      <div className="max-w-sm px-4">
        <p className="serif text-2xl text-ink">{title}</p>
        <p className="mt-2 text-sm text-muted">
          {detail || "The connection dropped or the store didn’t answer. Nothing on your side is wrong."}
        </p>
        {onRetry && (
          <Button onClick={onRetry} variant="secondary" className="mt-5">Try again</Button>
        )}
      </div>
    </div>
  );
}

/**
 * Catches a render crash so one broken component doesn't blank the whole site.
 *
 * A class component because that is still the only way to implement `componentDidCatch`.
 * Errors are logged rather than shown: a stack trace tells a shopper nothing and tells an
 * attacker something.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[render error]", error, info.componentStack);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="wrap grid min-h-[60vh] place-items-center py-20 text-center">
        <div className="max-w-sm">
          <TulipMark className="mx-auto h-10 w-10 text-plum/70" />
          <h1 className="serif mt-4 text-3xl font-medium text-ink">Something broke on this page</h1>
          <p className="mt-2 text-sm text-muted">
            Your cart and wishlist are safe — they’re stored on this device. Reloading usually clears it.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {/* A hard reload, not a router navigation: the component tree is already in a bad
                state, so re-rendering it would land in the same place. */}
            <Button onClick={() => window.location.reload()} variant="primary">Reload the page</Button>
            <Link to="/" className="btn btn-ghost px-5 py-2.5" onClick={() => this.setState({ crashed: false })}>Back to home</Link>
          </div>
        </div>
      </div>
    );
  }
}
