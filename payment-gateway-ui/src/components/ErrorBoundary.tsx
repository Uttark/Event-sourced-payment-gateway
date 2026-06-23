'use client';

import React, { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children:     ReactNode;

  sectionName?: string;

  fallback?:    ReactNode;
}

interface State {
  hasError: boolean;
  error:    Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(
      `[ErrorBoundary] "${this.props.sectionName ?? 'Section'}" crashed:`,
      error.message,
      '\nComponent stack:',
      errorInfo.componentStack,
    );
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div className="rounded-xl border border-[#fbbf24]/20 bg-[#fbbf24]/5 p-6 text-center">
        <AlertTriangle className="mx-auto mb-3 text-[#fbbf24]" size={24} />
        <p className="mb-1 text-sm font-medium text-[#f0f2f5]">
          {this.props.sectionName
            ? `${this.props.sectionName} failed to load`
            : 'This section encountered an error'}
        </p>
        <p className="mb-4 text-xs text-[#6b7280]">
          The rest of the page is still functional. Your balance and funds are safe.
        </p>
        <button
          onClick={this.handleReset}
          className="mx-auto flex items-center gap-2 rounded-xl border border-white/[0.06]
                     px-4 py-2 text-sm text-[#6b7280] transition-colors hover:text-[#f0f2f5]"
        >
          <RefreshCw size={14} />
          Retry
        </button>
      </div>
    );
  }
}
