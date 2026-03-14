// ==========================================
// ErrorBoundary — catches render crashes
// ==========================================

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, errorMessage: '' };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, errorMessage: error.message };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    height: '100vh', background: '#1C1B1F', color: '#fff', textAlign: 'center', padding: '2rem',
                }}>
                    <h1 style={{ fontSize: '2rem', fontWeight: 900, marginBottom: '0.5rem' }}>Something went wrong</h1>
                    <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '1.5rem', maxWidth: '400px' }}>
                        {this.state.errorMessage || 'An unexpected error occurred.'}
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '0.8rem 2rem', background: '#6750A4', border: 'none',
                            borderRadius: '12px', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '1rem',
                            boxShadow: '0 4px 15px rgba(103, 80, 164, 0.4)',
                        }}
                    >
                        🔄 Reload
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
