import { QRCodeSVG } from 'qrcode.react';
import { CROSSHAIR_COLORS, PRE_CONFIG_AVATARS, PRE_CONFIG_NAMES } from '../../shared/types';
import type { LobbyState } from '../../shared/types';
import '../../index.css';
import '../../animations.css';

const LIME_GREEN = '#C8F526';

interface LandingPageProps {
    connectionError: string | null;
    roomId?: string | null;
    joinToken?: string | null;
    lobby?: LobbyState | null;
}

export default function LandingPage({ connectionError, roomId, joinToken, lobby }: LandingPageProps) {
    const controllerUrl =
        roomId && joinToken
            ? `${window.location.origin}/controller/${roomId}/${joinToken}`
            : '';

    // Error state
    if (connectionError) {
        return (
            <div className="screen-container">
                <div className="waiting-screen">
                    <h2 className="waiting-title" style={{ color: '#ff4444' }}>Connection Failed</h2>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '1rem', fontSize: '1rem' }}>{connectionError}</p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{ marginTop: '1.5rem', padding: '0.8rem 2rem', background: 'var(--accent-primary)', border: 'none', borderRadius: 'var(--radius-md)', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '1rem' }}
                    >
                        🔄 Retry
                    </button>
                </div>
            </div>
        );
    }

    // Connecting — no room yet
    if (!controllerUrl) {
        return (
            <div className="screen-container">
                <div className="waiting-screen">
                    <div className="pulse-ring" />
                    <h2 className="waiting-title">Connecting to Server...</h2>
                </div>
            </div>
        );
    }

    // Room ready — show QR card matching GameLobby_Screen style
    return (
        <div
            style={{
                background: '#121215',
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'Inter, sans-serif',
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            {/* Header */}
            <div
                style={{
                    position: 'absolute',
                    top: '2.5rem',
                    left: '0',
                    right: '0',
                    padding: '0 3rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    zIndex: 100,
                }}
            >
                <div className="saas-title" style={{ margin: 0, fontSize: '4.5rem', lineHeight: 1 }}>
                    Play Together <span className="saas-title-highlight">Instantly</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div
                        style={{
                            color: LIME_GREEN,
                            fontSize: '1.3rem',
                            fontWeight: 800,
                            letterSpacing: '2px',
                        }}
                    >
                        WonderLoop
                    </div>
                </div>
            </div>

            {/* QR Card */}
            <div
                className="saas-qr-glass-card"
                style={{
                    borderRadius: '2.5vw',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '2vw',
                    padding: '2vw 2.5vw',
                    minWidth: '280px',
                    maxWidth: '340px',
                    width: '22vw',
                }}
            >
                <div
                    className="saas-scan-prompt"
                    style={{
                        fontSize: '1.2vw',
                        width: '100%',
                        justifyContent: 'center',
                        background: 'transparent',
                        border: 'none',
                        padding: '0',
                        boxShadow: 'none',
                    }}
                >
                    <i>🎯</i>
                    <span>Scan to Play</span>
                </div>

                <div
                    className="saas-qr-wrapper"
                    style={{
                        width: '75%',
                        aspectRatio: '1/1',
                        padding: '1vw',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <QRCodeSVG
                        value={controllerUrl}
                        style={{ width: '100%', height: '100%' }}
                        level="H"
                        fgColor="#1c1b1f"
                    />
                </div>

                {/* Player slots */}
                <div
                    style={{
                        display: 'flex',
                        gap: '1vw',
                        width: '100%',
                        justifyContent: 'center',
                    }}
                >
                    {[0, 1, 2, 3].map((slotIndex) => {
                        const player = lobby?.players.find((p) => p.colorIndex === slotIndex);
                        const isJoined = !!player;
                        const avatar = PRE_CONFIG_AVATARS[slotIndex];
                        const playerColor = CROSSHAIR_COLORS[slotIndex];
                        return (
                            <div
                                key={slotIndex}
                                style={{
                                    width: '3.5vw',
                                    height: '3.5vw',
                                    minWidth: '36px',
                                    minHeight: '36px',
                                    borderRadius: '50%',
                                    background: 'transparent',
                                    border: isJoined
                                        ? `2px solid ${playerColor}`
                                        : '2px dashed rgba(255,255,255,0.15)',
                                    boxShadow: isJoined ? `0 0 10px ${playerColor}80` : 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    overflow: 'hidden',
                                    transition: 'all 0.4s ease',
                                    flexShrink: 0,
                                }}
                            >
                                <img
                                    src={`/avatars/${avatar}.png`}
                                    alt={PRE_CONFIG_NAMES[slotIndex]}
                                    style={{
                                        width: '90%',
                                        height: '90%',
                                        objectFit: 'contain',
                                        opacity: isJoined ? 1 : 0.3,
                                        transition: 'opacity 0.4s ease',
                                    }}
                                />
                            </div>
                        );
                    })}
                </div>

                <div
                    style={{
                        color: 'var(--text-secondary)',
                        fontSize: '1.2vw',
                        fontWeight: 600,
                    }}
                >
                    1 – 4 Players
                </div>
            </div>
        </div>
    );
}
