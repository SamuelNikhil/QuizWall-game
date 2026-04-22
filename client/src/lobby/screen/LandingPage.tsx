import '../../index.css';
import '../../animations.css';

interface LandingPageProps {
    connectionError: string | null;
}

export default function LandingPage({ connectionError }: LandingPageProps) {
    return (
        <div className="screen-container">
            <div className="waiting-screen">
                {connectionError ? (
                    <>
                        <h2 className="waiting-title" style={{ color: '#ff4444' }}>Connection Failed</h2>
                        <p style={{ color: 'var(--text-secondary)', marginTop: '1rem', fontSize: '1rem' }}>{connectionError}</p>
                        <button
                            onClick={() => window.location.reload()}
                            style={{ marginTop: '1.5rem', padding: '0.8rem 2rem', background: 'var(--accent-primary)', border: 'none', borderRadius: 'var(--radius-md)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '1rem' }}
                        >
                            🔄 Retry
                        </button>
                    </>
                ) : (
                    <>
                        <div className="pulse-ring" />
                        <h2 className="waiting-title">Connecting to Server...</h2>
                    </>
                )}
            </div>
        </div>
    );
}