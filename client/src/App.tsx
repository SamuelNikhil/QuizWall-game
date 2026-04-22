// ==========================================
// App — Root Router
// Code-split: Screen and Controller load independently
// ==========================================

import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './shared/ErrorBoundary';

// Lazy-load page components for smaller initial bundles
const ShootQuiz_Screen = lazy(() => import('./pages/ShootQuiz_Screen'));
const ShootQuiz_Controller = lazy(() => import('./pages/ShootQuiz_Controller'));

// Minimal loading fallback (matches app theme)
const LoadingFallback = () => (
    <div style={{
        width: '100vw', height: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#1c1b1f', color: '#e6e1e5',
        fontFamily: 'system-ui, sans-serif', fontSize: '1.2rem',
    }}>
        <div style={{ textAlign: 'center' }}>
            <div style={{
                width: '48px', height: '48px', margin: '0 auto 1rem',
                border: '4px solid rgba(103, 80, 164, 0.3)',
                borderTop: '4px solid #6750a4',
                borderRadius: '50%', animation: 'spin 1s linear infinite',
            }} />
            Loading...
        </div>
    </div>
);

export default function App() {
    return (
        <BrowserRouter>
            <ErrorBoundary>
                <Suspense fallback={<LoadingFallback />}>
                    <Routes>
                        <Route path="/" element={<ShootQuiz_Screen />} />
                        <Route path="/screen" element={<ShootQuiz_Screen />} />
                        <Route path="/controller/:roomId/:token" element={<ShootQuiz_Controller />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </Suspense>
            </ErrorBoundary>
        </BrowserRouter>
    );
}
