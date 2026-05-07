import { CROSSHAIR_COLORS, PRE_CONFIG_NAMES, PRE_CONFIG_AVATARS } from '../../shared/types';
import '../../index.css';
import '../../animations.css';

interface LoadingControllerProps {
    colorIndex: number;
    countdownActive: boolean;
    countdownValue: number;
}

export default function Loading_Controller({ colorIndex, countdownActive, countdownValue }: LoadingControllerProps) {
    const myColor = CROSSHAIR_COLORS[colorIndex] || '#6750A4';
    const characterAvatar = PRE_CONFIG_AVATARS[colorIndex] || 'wulf';
    const characterName = PRE_CONFIG_NAMES[colorIndex] || `Player ${colorIndex + 1}`;

    return (
        <div className="controller-container" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100vw',
            minHeight: '100vh',
            height: '100dvh',
            boxSizing: 'border-box',
            paddingTop: 'max(1.25rem, calc(env(safe-area-inset-top) + 1rem))',
            paddingRight: '2rem',
            paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 1.25rem))',
            paddingLeft: '2rem',
            background: 'linear-gradient(180deg, #0f0f1a 0%, #1a1a2e 100%)',
        }}>
            <div style={{
                flex: 1,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
            }}>
                {/* Player Avatar */}
                <img
                    src={`/avatars/${characterAvatar}.png`}
                    alt={characterName}
                    style={{
                        width: '120px',
                        height: '120px',
                        objectFit: 'contain',
                        filter: `drop-shadow(0 0 20px ${myColor}40)`,
                        marginBottom: '2rem',
                        animation: 'bounceIn 0.6s ease-out avatar-float',
                    }}
                />

                {/* Countdown Timer or Loading State */}
                {countdownActive ? (
                    <div style={{
                        width: '100px',
                        height: '100px',
                        borderRadius: '50%',
                        border: '4px solid rgba(255,255,255,0.1)',
                        borderTop: '4px solid #ff9500',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        animation: 'spin 1s linear infinite',
                        marginBottom: '2rem',
                    }}>
                        <span className="countdown-number" style={{
                            fontSize: '2.5rem',
                            fontWeight: 900,
                            color: '#fff',
                        }}>
                            {countdownValue}
                        </span>
                    </div>
                ) : (
                    <div style={{
                        width: '50px',
                        height: '50px',
                        border: '4px solid rgba(255,255,255,0.1)',
                        borderTop: `4px solid ${myColor}`,
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                        marginBottom: '2rem',
                    }} />
                )}

                {/* GET READY! Text */}
                <h2 style={{
                    fontSize: '2rem',
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

                <p style={{
                    fontSize: '0.95rem',
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: '1.5rem',
                    textAlign: 'center',
                }}>
                    {countdownActive ? 'Game starting soon' : 'Preparing your game'}
                </p>
            </div>

            {/* AIM ZONE • LOADING Bar */}
            <div style={{
                width: '100%',
                maxWidth: '300px',
                padding: '1rem 1.5rem',
                background: 'rgba(255,255,255,0.05)',
                borderRadius: '16px',
                border: '1px solid rgba(255,255,255,0.1)',
                textAlign: 'center',
            }}>
                <span style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: 'rgba(255,255,255,0.4)',
                    letterSpacing: '2px',
                    textTransform: 'uppercase',
                }}>
                    AIM ZONE • LOADING
                </span>
            </div>
        </div>
    );
}