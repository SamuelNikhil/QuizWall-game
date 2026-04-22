import type { LobbyState } from '../../shared/types';
import { CROSSHAIR_COLORS } from '../../shared/types';
import backgroundImg from '../../assets/Background.svg';

interface Loading_ScreenProps {
    lobby: LobbyState | null;
    countdownActive: boolean;
    countdownValue: number;
    showReadyOverlay: boolean;
    selectedTopicLabel: string | null;
}

const preConfigNames = ["Wulf", "Talon", "Ryker", "Zark"];
const preConfigAvatars = ["wulf", "talon", "ryker", "zark"];

export default function Loading_Screen({ lobby, countdownActive, countdownValue, showReadyOverlay, selectedTopicLabel }: Loading_ScreenProps) {
    const loadingUI = (
        <div className="screen-container" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            background: `url(${backgroundImg}) center/cover no-repeat`,
            padding: '2rem',
            position: 'relative',
        }}>
            {/* Player Avatars Row */}
            <div style={{
                display: 'flex',
                gap: '2rem',
                marginBottom: '3rem',
                animation: 'bounceIn 0.6s ease-out',
            }}>
                {lobby?.players.map((player) => (
                    <div key={player.id} style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.5rem',
                    }}>
                        <div style={{
                            width: '100px',
                            height: '100px',
                            borderRadius: '50%',
                            border: `3px solid ${CROSSHAIR_COLORS[player.colorIndex ?? 0]}`,
                            boxShadow: `0 0 30px ${CROSSHAIR_COLORS[player.colorIndex ?? 0]}40`,
                            background: 'rgba(255,255,255,0.05)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                        }}>
                            <img
                                src={`/avatars/${preConfigAvatars[player.colorIndex ?? 0]}.png`}
                                alt={preConfigNames[player.colorIndex ?? 0]}
                                style={{
                                    width: '90%',
                                    height: '90%',
                                    objectFit: 'contain',
                                }}
                            />
                        </div>
                        <span style={{
                            fontSize: '1.1rem',
                            fontWeight: 700,
                            color: '#fff',
                        }}>
                            {preConfigNames[player.colorIndex ?? 0]}
                        </span>
                        {player.role === 'leader' && (
                            <span style={{
                                fontSize: '0.7rem',
                                fontWeight: 800,
                                color: 'rgba(255,255,255,0.5)',
                                textTransform: 'uppercase',
                                background: 'rgba(255,255,255,0.1)',
                                padding: '0.25rem 0.75rem',
                                borderRadius: '12px',
                            }}>
                                Host
                            </span>
                        )}
                    </div>
                ))}
            </div>

            {/* Countdown Timer or Loading State */}
            {countdownActive ? (
                <div style={{
                    width: '120px',
                    height: '120px',
                    borderRadius: '50%',
                    border: '4px solid rgba(255,255,255,0.1)',
                    borderTop: `4px solid #ff9500`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    animation: 'spin 1s linear infinite',
                    marginBottom: '2rem',
                }}>
                    <span className="countdown-number" style={{
                        fontSize: '3.5rem',
                        fontWeight: 900,
                        color: '#fff',
                    }}>
                        {countdownValue}
                    </span>
                </div>
            ) : (
                <div style={{
                    width: '60px',
                    height: '60px',
                    border: '4px solid rgba(255,255,255,0.1)',
                    borderTop: `4px solid #6750a4`,
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    marginBottom: '2rem',
                }} />
            )}

            {/* GET READY! Text */}
            <h2 style={{
                fontSize: '3rem',
                fontWeight: 950,
                color: '#fff',
                marginBottom: '0.5rem',
                background: 'linear-gradient(135deg, #ff6b35 0%, #ff4444 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                textTransform: 'uppercase',
                letterSpacing: '2px',
                animation: 'pulse 1.5s ease-in-out infinite',
            }}>
                GET READY!
            </h2>

            {selectedTopicLabel && (
                <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 1.25rem',
                    background: 'rgba(109, 40, 217, 0.25)',
                    border: '1px solid rgba(167, 139, 250, 0.4)',
                    borderRadius: '30px',
                    marginBottom: '0.75rem',
                }}>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '1px' }}>
                        Topic: {selectedTopicLabel}
                    </span>
                </div>
            )}

            <p style={{
                fontSize: '1.1rem',
                color: 'rgba(255,255,255,0.5)',
                marginBottom: '3rem',
            }}>
                {countdownActive ? 'Game starting soon' : 'Preparing your game'}
            </p>

            {/* Loading Progress Bar */}
            {!countdownActive && (
                <div style={{
                    width: '300px',
                    height: '6px',
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                }}>
                    <div className="loading-progress-bar" style={{
                        height: '100%',
                        background: 'linear-gradient(90deg, #6750a4, #95d4e4)',
                    }} />
                </div>
            )}
        </div>
    );

    const readyOverlay = showReadyOverlay ? (
        <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15, 15, 26, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            animation: 'loadingZoomIn 0.5s ease-out forwards',
        }}>
            {/* Player Avatars Row */}
            <div style={{
                display: 'flex',
                gap: '3rem',
                marginBottom: '4rem',
                animation: 'bounceIn 0.6s ease-out',
            }}>
                {lobby?.players.map((player) => (
                    <div key={player.id} style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.75rem',
                    }}>
                        <div style={{
                            width: '120px',
                            height: '120px',
                            borderRadius: '50%',
                            border: `4px solid ${CROSSHAIR_COLORS[player.colorIndex ?? 0]}`,
                            boxShadow: `0 0 40px ${CROSSHAIR_COLORS[player.colorIndex ?? 0]}60`,
                            background: 'rgba(255,255,255,0.05)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                        }}>
                            <img
                                src={`/avatars/${preConfigAvatars[player.colorIndex ?? 0]}.png`}
                                alt={preConfigNames[player.colorIndex ?? 0]}
                                style={{
                                    width: '95%',
                                    height: '95%',
                                    objectFit: 'contain',
                                }}
                            />
                        </div>
                        <span style={{
                            fontSize: '1.3rem',
                            fontWeight: 800,
                            color: '#fff',
                            textShadow: `0 0 20px ${CROSSHAIR_COLORS[player.colorIndex ?? 0]}`,
                        }}>
                            {preConfigNames[player.colorIndex ?? 0]}
                        </span>
                    </div>
                ))}
            </div>

            <h2 style={{
                fontSize: '4rem',
                fontWeight: 950,
                color: '#fff',
                marginBottom: '1rem',
                background: 'linear-gradient(135deg, #ff6b35 0%, #ff4444 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                textTransform: 'uppercase',
                letterSpacing: '3px',
                animation: 'pulse 1s ease-in-out infinite',
            }}>
                GET READY!
            </h2>

            {selectedTopicLabel && (
                <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 1.5rem',
                    background: 'rgba(109, 40, 217, 0.3)',
                    border: '1px solid rgba(167, 139, 250, 0.5)',
                    borderRadius: '30px',
                    marginBottom: '1rem',
                }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '1px' }}>
                        Topic: {selectedTopicLabel}
                    </span>
                </div>
            )}

            <p style={{
                fontSize: '1.3rem',
                color: 'rgba(255,255,255,0.6)',
                textAlign: 'center',
            }}>
                Game starting now
            </p>
        </div>
    ) : null;

    return (
        <>
            {loadingUI}
            {readyOverlay}
        </>
    );
}