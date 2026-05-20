import { useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import shuffleSoundUrl from '../../assets/sounds/shuffle.mp3';
import backgroundVideo from '../../assets/QuizWall.webm';
import { CROSSHAIR_COLORS, PRE_CONFIG_NAMES, PRE_CONFIG_AVATARS } from '../../shared/types';
import type { LobbyState } from '../../shared/types';
import '../../animations.css';

export interface GameLobby_ScreenProps {
    roomId: string | null;
    joinToken: string | null;
    lobby: LobbyState | null;
    phase: 'qr-lobby' | 'team-lobby';
    cardShuffleComplete: boolean;
    qrCardCollapsed: boolean;
    setCardShuffleComplete: (v: boolean) => void;
    setQrCardCollapsed: (v: boolean) => void;
}

const LIME_GREEN = '#C8F526';

export default function GameLobby_Screen({
    roomId,
    joinToken,
    lobby,
    phase,
    cardShuffleComplete,
    qrCardCollapsed,
    setCardShuffleComplete,
    setQrCardCollapsed,
}: GameLobby_ScreenProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hasPlayedShuffleRef = useRef(false);
    // Pre-created audio element — primed muted on mount so the browser
    // allows unmuted playback later (no user gesture needed on screen/TV).
    const shuffleAudioRef = useRef<HTMLAudioElement | null>(null);

    const controllerUrl =
        roomId && joinToken
            ? `${window.location.origin}/controller/${roomId}/${joinToken}`
            : '';

    // On mount: create the audio element, preload it, and play it muted+paused
    // immediately. This "primes" the browser's autoplay permission for this element.
    useEffect(() => {
        const audio = new Audio(shuffleSoundUrl);
        audio.preload = 'auto';
        audio.volume = 0;
        audio.muted = true;
        shuffleAudioRef.current = audio;

        // Play muted — always allowed, primes the pipeline
        const p = audio.play();
        if (p) {
            p.then(() => {
                audio.pause();
                audio.currentTime = 0;
                audio.muted = false;
                audio.volume = 0.3;
            }).catch(() => {
                // Even if muted play fails, keep the ref for later attempts
                audio.muted = false;
                audio.volume = 0.3;
            });
        }

        return () => {
            audio.pause();
            shuffleAudioRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (phase === 'team-lobby' && !hasPlayedShuffleRef.current) {
            hasPlayedShuffleRef.current = true;

            const playOne = (index: number) => {
                setTimeout(() => {
                    const el = shuffleAudioRef.current;
                    if (!el) return;
                    // Clone the element so we can overlap 4 plays
                    const clone = el.cloneNode() as HTMLAudioElement;
                    clone.volume = 0.3;
                    clone.currentTime = 0;
                    clone.play().catch(() => {});
                }, index * 100);
            };

            for (let i = 0; i < 4; i++) playOne(i);
        }
    }, [phase]);

    useEffect(() => {
        if (phase === 'team-lobby') {
            setCardShuffleComplete(false);
            setQrCardCollapsed(false);
            const t = setTimeout(() => setCardShuffleComplete(true), 1100);
            return () => clearTimeout(t);
        } else {
            setCardShuffleComplete(false);
            setQrCardCollapsed(false);
        }
    }, [phase, setCardShuffleComplete, setQrCardCollapsed]);

    useEffect(() => {
        if (!cardShuffleComplete) return;
        const t = setTimeout(() => setQrCardCollapsed(true), 900);
        return () => clearTimeout(t);
    }, [cardShuffleComplete, setQrCardCollapsed]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const playVideo = async () => {
            try {
                if (video.paused) {
                    await video.play().catch(() => {});
                }
            } catch {}
        };

        playVideo();
        video.addEventListener('ended', playVideo);
        video.addEventListener('pause', playVideo);

        return () => {
            video.removeEventListener('ended', playVideo);
            video.removeEventListener('pause', playVideo);
        };
    }, []);

    const isTeamLobby = phase === 'team-lobby' && (lobby?.players.length ?? 0) > 0;

    // ── Team Lobby (Game Lobby) ──
    if (isTeamLobby) {
        const flyX = ['-62vw', '-52vw', '-41vw', '-30vw'];
        const flyY = '-8vh';

        return (
            <div
                style={{
                    background: '#121215',
                    height: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '0 3rem',
                    justifyContent: 'center',
                    fontFamily: 'Inter, sans-serif',
                    overflow: 'hidden',
                }}
            >
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
                    <div
                        className="saas-title"
                        style={{ margin: 0, fontSize: '4.5rem', lineHeight: 1 }}
                    >
                        Game <span className="saas-title-highlight">Lobby</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div
                            style={{
                                color: LIME_GREEN,
                                fontSize: '0.8rem',
                                fontWeight: 800,
                                letterSpacing: '2px',
                                marginBottom: '4px',
                            }}
                        >
                           
                        </div>
                        
                        
                    </div>
                </div>

                <div
                    style={{
                        flex: 1,
                        display: 'flex',
                        gap: '2rem',
                        minHeight: 0,
                        marginTop: '8rem',
                        marginBottom: '4rem',
                        alignItems: 'center',
                    }}
                >
                    <div
                        style={{
                            flex: 1.8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'nowrap' }}>
                            {[0, 1, 2, 3].map((slotIndex) => {
                                const player = lobby?.players.find(
                                    (p) => p.colorIndex === slotIndex
                                );
                                const name = player?.name || PRE_CONFIG_NAMES[slotIndex] || 'Waiting...';
                                const avatar = PRE_CONFIG_AVATARS[slotIndex];
                                const isJoined = !!player;
                                const uiColor = isJoined
                                    ? CROSSHAIR_COLORS[player?.colorIndex ?? slotIndex] ||
                                      CROSSHAIR_COLORS[0]
                                    : 'rgba(255, 255, 255, 0.15)';

                                return (
                                    <div
                                        key={slotIndex}
                                        className={`lobby-card-v2 ${isJoined ? 'is-joined' : 'is-empty'}`}
                                        style={
                                            {
                                                '--card-color': uiColor,
                                                '--wave-delay': `${slotIndex * 0.4}s`,
                                                borderColor: uiColor,
                                                width: '180px',
                                                height: '280px',
                                                animationDelay: `${slotIndex * 0.1}s, ${1.2 + slotIndex * 0.4}s`,
                                            } as React.CSSProperties
                                        }
                                    >
                                        <div
                                            className="card-avatar-wrapper"
                                            style={{
                                                width: '110px',
                                                height: '110px',
                                                marginBottom: '1rem',
                                            }}
                                        >
                                            <img
                                                src={`/avatars/${avatar}.png`}
                                                alt={name}
                                                className="lobby-avatar-v2"
                                                style={{
                                                    width: '120px',
                                                    height: '120px',
                                                    opacity: cardShuffleComplete
                                                        ? isJoined
                                                            ? 1
                                                            : 0.35
                                                        : 0,
                                                    transform: cardShuffleComplete
                                                        ? 'scale(1) translateY(0)'
                                                        : 'scale(0.6) translateY(10px)',
                                                    transition:
                                                        'opacity 0.5s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                                    transitionDelay: cardShuffleComplete
                                                        ? `${slotIndex * 0.08}s`
                                                        : '0s',
                                                }}
                                            />
                                        </div>

                                        <div style={{ textAlign: 'center' }}>
                                            <div
                                                style={{
                                                    color: player
                                                        ? '#fff'
                                                        : 'rgba(255, 255, 255, 0.4)',
                                                    fontWeight: 700,
                                                    fontSize: '1.2rem',
                                                    marginBottom: '0.25rem',
                                                }}
                                            >
                                                {name}
                                            </div>
                                            {player ? (
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        gap: '0.3rem',
                                                    }}
                                                >
                                                    {player.role === 'leader' && (
                                                        <div
                                                            style={{
                                                                padding: '0.35rem 1rem',
                                                                background: `linear-gradient(135deg, ${uiColor}40, ${uiColor}20)`,
                                                                borderRadius: '20px',
                                                                border: `1px solid ${uiColor}60`,
                                                                fontSize: '0.7rem',
                                                                fontWeight: 800,
                                                                color: '#fff',
                                                                textTransform: 'uppercase',
                                                                letterSpacing: '1px',
                                                            }}
                                                        >
                                                            HOST
                                                        </div>
                                                    )}
                                                    <div
                                                        className="status-badge ready"
                                                        style={{ fontSize: '0.7rem' }}
                                                    >
                                                        READY
                                                    </div>
                                                </div>
                                            ) : (
                                                <div
                                                    className="status-badge empty"
                                                    style={{ fontSize: '0.7rem' }}
                                                >
                                                    CONNECTING...
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div
                        className="saas-qr-glass-card"
                        style={{
                            flex: qrCardCollapsed ? 'none' : '0.5',
                            marginLeft: '5vw',
                            maxWidth: qrCardCollapsed ? '240px' : '280px',
                            width: '100%',
                            borderRadius: '32px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '2vw',
                            padding: qrCardCollapsed ? '1rem 0.75rem' : '1.5vw 2vw',
                            height: qrCardCollapsed ? '320px' : '100%',
                            alignSelf: qrCardCollapsed ? 'center' : 'auto',
                            overflow: 'visible',
                            position: 'relative',
                            transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                        }}
                    >
                        <div
                            className="saas-scan-prompt"
                            style={{
                                fontSize: qrCardCollapsed ? '0.75rem' : '1.1rem',
                                width: '100%',
                                justifyContent: 'center',
                                background: 'transparent',
                                border: 'none',
                                padding: '0',
                                boxShadow: 'none',
                                transition: 'font-size 0.6s',
                            }}
                        >
                            <i>📱</i>
                            <span>Scan to Play</span>
                        </div>

                        <div
                            className="saas-qr-wrapper"
                            style={{
                                width: '75%',
                                aspectRatio: '1/1',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <QRCodeSVG
                                value={controllerUrl}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                                }}
                                level="H"
                                fgColor="#1c1b1f"
                            />
                        </div>

                        <div
                            style={{
                                display: 'flex',
                                gap: '0.5rem',
                                width: '100%',
                                justifyContent: 'center',
                                overflow: 'visible',
                                maxHeight: qrCardCollapsed ? '0px' : '50px',
                                opacity: qrCardCollapsed ? 0 : 1,
                                margin: qrCardCollapsed ? '0' : '0.25rem 0',
                                transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                                pointerEvents: 'none',
                            }}
                        >
                            {[0, 1, 2, 3].map((slotIndex) => {
                                const player = lobby?.players.find(
                                    (p) => p.colorIndex === slotIndex
                                );
                                const isJoined = !!player;
                                const avatar = PRE_CONFIG_AVATARS[slotIndex];
                                const playerColor = CROSSHAIR_COLORS[slotIndex];
                                return (
                                    <div
                                        key={slotIndex}
                                        style={{
                                            width: qrCardCollapsed ? '32px' : '3.5vw',
                                            height: qrCardCollapsed ? '32px' : '3.5vw',
                                            borderRadius: '50%',
                                            background: 'transparent',
                                            border: isJoined
                                                ? `2px solid ${playerColor}`
                                                : '2px dashed rgba(255,255,255,0.15)',
                                            boxShadow: isJoined
                                                ? `0 0 10px ${playerColor}80`
                                                : 'none',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            overflow: 'visible',
                                            flexShrink: 0,
                                            transform: cardShuffleComplete
                                                ? `translateX(${flyX[slotIndex]}) translateY(${flyY}) scale(2.8)`
                                                : 'translate(0, 0) scale(1)',
                                            opacity: cardShuffleComplete ? 0 : 1,
                                            transition:
                                                'transform 0.65s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease',
                                            transitionDelay: `${slotIndex * 0.07}s`,
                                            zIndex: 100,
                                            pointerEvents: 'none',
                                        }}
                                    >
                                        <img
                                            src={`/avatars/${avatar}.png`}
                                            alt={PRE_CONFIG_NAMES[slotIndex]}
                                            style={{
                                                width: '90%',
                                                height: '90%',
                                                objectFit: 'contain',
                                                display: 'block',
                                                borderRadius: '50%',
                                            }}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── QR Landing page ──
    return (
        <div
            className="wf-landing-screen"
            style={{
                background: '#121215',
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'Inter, sans-serif',
                overflow: 'hidden',
            }}
        >
            <div
                className="landing-header"
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
                <div
                    className="saas-title"
                    style={{ margin: 0, fontSize: '4.5rem', lineHeight: 1 }}
                >
                    Play Together <span className="saas-title-highlight">Instantly</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div
                        style={{
                            color: LIME_GREEN,
                            fontSize: '1.3rem',
                            fontWeight: 800,
                            letterSpacing: '2px',
                            marginBottom: '4px',
                        }}
                    >
                        WonderLoop
                    </div>
                   
                </div>
            </div>

            <div className="landing-mobile-wonderloop">
                <div
                    style={{
                        fontSize: '2.5rem',
                        fontWeight: 900,
                        lineHeight: 1.1,
                        background:
                            'linear-gradient(135deg, #ffffff 0%, rgba(255,255,255,0.6) 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                    }}
                >
                    Play Together
                    <br />
                    <span className="saas-title-highlight">Instantly</span>
                </div>
            </div>

            <div className="landing-mobile-logo">
                <div
                    style={{
                        color: LIME_GREEN,
                        fontSize: '1.2rem',
                        fontWeight: 800,
                        letterSpacing: '3px',
                        marginBottom: '8px',
                    }}
                >
                    WONDERLOOP
                </div>
               
            </div>

            <div
                className="landing-main-content"
                style={{
                    flex: 1,
                    display: 'flex',
                    width: '100%',
                    alignItems: 'stretch',
                    justifyContent: 'center',
                    marginTop: '11rem',
                    marginBottom: '4rem',
                    padding: '0 3rem',
                    minHeight: 0,
                }}
            >
                <div
                    style={{
                        flex: 1.35,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1.1vw',
                        minHeight: 0,
                    }}
                >
                    <div
                        style={{
                            width: '100%',
                            aspectRatio: '2/1',
                            borderRadius: '3vw',
                            overflow: 'hidden',
                            position: 'relative',
                            boxShadow: '0 4px 30px rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                        }}
                    >
                        <video
                            ref={videoRef}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            autoPlay
                            loop
                            muted
                            playsInline
                            preload="auto"
                        >
                            <source src={backgroundVideo} type="video/webm" />
                        </video>
                    </div>
                    <div style={{ display: 'flex', gap: '1vw', flexShrink: 0 }}>
                        <div
                            style={{
                                background: 'rgba(255,255,255,0.08)',
                                backdropFilter: 'blur(10px)',
                                WebkitBackdropFilter: 'blur(10px)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '1.2vw',
                                padding: '1.5vw 2vw',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1vw',
                                boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                            }}
                        >
                            <div
                                style={{
                                    width: '1.8vw',
                                    height: '1.8vw',
                                    borderRadius: '50%',
                                    background: LIME_GREEN,
                                    boxShadow: `0 0 10px ${LIME_GREEN}40`,
                                    flexShrink: 0,
                                }}
                            />
                            <span
                                style={{
                                    color: 'white',
                                    fontSize: '1.2vw',
                                    fontWeight: 600,
                                }}
                            >
                                ShootQuiz
                            </span>
                        </div>
                    </div>
                </div>

                <div
                    className="saas-qr-glass-card"
                    style={{
                        flex: 0.55,
                        marginLeft: '6vw',
                        borderRadius: '2.5vw',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2vw',
                        padding: '2vw 2vw',
                        alignSelf: 'flex-start',
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

                    <div
                        style={{
                            display: 'flex',
                            gap: '1vw',
                            width: '100%',
                            justifyContent: 'center',
                        }}
                    >
                        {[0, 1, 2, 3].map((slotIndex) => {
                            const player = lobby?.players.find(
                                (p) => p.colorIndex === slotIndex
                            );
                            const isJoined = !!player;
                            const avatar = PRE_CONFIG_AVATARS[slotIndex];
                            const playerColor = CROSSHAIR_COLORS[slotIndex];
                            return (
                                <div
                                    key={slotIndex}
                                    style={{
                                        width: '3.5vw',
                                        height: '3.5vw',
                                        borderRadius: '50%',
                                        background: 'transparent',
                                        border: isJoined
                                            ? `2px solid ${playerColor}`
                                            : '2px dashed rgba(255,255,255,0.15)',
                                        boxShadow: isJoined
                                            ? `0 0 10px ${playerColor}80`
                                            : 'none',
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
                                            opacity: 1,
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
        </div>
    );
}