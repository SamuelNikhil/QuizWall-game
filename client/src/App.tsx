// ==========================================
// App — Root Router
// Plugin-based gamemode routing.
// Screen: /                    → default game (ShootQuiz)
// Screen: /game/:gameType      → specific game screen
// Controller: /controller/:roomId/:token  → game controller
//   (game type is resolved from the room on the server)
// ==========================================

import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './shared/ErrorBoundary';

// ---- Game screens (lazy-loaded per game) ----
const ShootQuiz_Screen = lazy(() => import('./modes/ShootQuiz/ShootQuiz_Screen'));
const ShootQuiz_Controller = lazy(() => import('./modes/ShootQuiz/ShootQuiz_Controller'));

// Minimal loading fallback
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
                        {/* ---- Screen routes ---- */}
                        {/* Default screen → ShootQuiz (current only game) */}
                        <Route path="/" element={<ShootQuiz_Screen />} />
                        <Route path="/screen" element={<ShootQuiz_Screen />} />

                        {/* Named game screen — add new games here as plugins */}
                        <Route path="/game/shootquiz" element={<ShootQuiz_Screen />} />

                        {/* ---- Controller route ---- */}
                        {/*
                         * The controller URL is game-agnostic: /controller/:roomId/:token
                         * The server embeds the gameType in the room; the controller
                         * component reads it from the JOINED_ROOM payload and renders
                         * the correct game UI. For now ShootQuiz is the only game.
                         */}
                        <Route path="/controller/:roomId/:token" element={<ShootQuiz_Controller />} />

                        {/* Catch-all */}
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </Suspense>
            </ErrorBoundary>
        </BrowserRouter>
    );
}
