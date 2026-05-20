// ==========================================
// ShootQuiz Screen — Refactored Presentation Layer
// Delegates lobby/loading phases to sub-components
// Keeps GamePlay_Screen and Winner_Screen inline
// ==========================================

import { useEffect, useState, useRef, useCallback, memo, useMemo } from 'react';
import { GameClient } from '../transport/GameClient';
import backgroundImg from '../assets/Background.svg';
import { ORB_POSITIONS, CROSSHAIR_COLORS, PRE_CONFIG_NAMES, PRE_CONFIG_AVATARS } from '../shared/types';
import type {
    ClientQuestion,
    HitResultPayload,
    LobbyState,
    GameOverPayload,
    PlayerSelectionPayload,
    PlayerScoreEntry,
    TopicSelectedPayload,
} from '../shared/types';
import '../animations.css';
import WinnerScene from '../components/WinnerScene';
import LandingPage from '../lobby/screen/LandingPage';
import GameLobby_Screen from '../lobby/screen/GameLobby_Screen';
import Loading_Screen from '../lobby/screen/Loading_Screen';
import TopicSelection_Screen from './TopicSelection_Screen';

type GamePhase = 'connecting' | 'qr-lobby' | 'team-lobby' | 'topic-selection' | 'loading' | 'playing' | 'game-over' | 'exit-scores';

interface Particle { id: string; x: number; y: number; size: number; color: string; '--tx': string; '--ty': string; }
interface ScorePopup { id: string; x: number; y: number; text: string; type: string; }
interface Ripple { id: string; x: number; y: number; color: string; size: number; }
interface Confetti { id: string; x: number; y: number; color: string; '--dx': string; '--dy': string; '--rot': string; width: number; height: number; }

// ---- GamePlay_Screen Inline Component ----
interface GamePlay_ScreenProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    arenaRef: React.RefObject<HTMLDivElement | null>;
    question: ClientQuestion | null;
    timeLeft: number;
    phaseTimeLeft: number;
    questionNumber: number;
    isTransitioning: boolean;
    showReadyOverlay: boolean;
    targetedOrbId: string | null;
    /** Pre-computed map of orbId → selections for O(1) lookup during render */
    selectionsMap: Map<string, PlayerSelectionPayload[]>;
    crosshairs: Map<string, { x: number; y: number }>;
    lobby: LobbyState | null;
    playerScores: PlayerScoreEntry[];
    particles: Particle[];
    scorePopups: ScorePopup[];
    ripples: Ripple[];
    confetti: Confetti[];
}

const GamePlay_Screen = memo(function GamePlay_Screen({
    containerRef,
    arenaRef,
    question,
    timeLeft,
    phaseTimeLeft,
    questionNumber,
    isTransitioning,
    showReadyOverlay,
    targetedOrbId,
    selectionsMap,
    crosshairs,
    lobby,
    playerScores,
    particles,
    scorePopups,
    ripples,
    confetti,
}: GamePlay_ScreenProps) {
    const currentTimerVal = phaseTimeLeft || timeLeft;
    const timerHue = Math.max(0, Math.min(120, (currentTimerVal / 20) * 120));
    const timerColor = `hsl(${timerHue}, 100%, 50%)`;
    const timerBgColor = `hsla(${timerHue}, 100%, 50%, 0.1)`;

    return (
        <div
            className="screen-container"
            ref={containerRef}
            style={{ background: `url(${backgroundImg}) center/cover no-repeat` }}
        >
            <header className="screen-header">
                {/* Top Bar - LIVE NOW and Round Info */}
                <div style={{
                    position: 'absolute',
                    top: '0',
                    left: '0',
                    right: '0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '1.5rem 2.5rem',
                    zIndex: 1000,
                }}>
                    {/* Timer Badge with animated border */}
                    <div style={{
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.8rem 2rem',
                        background: timerBgColor,
                        borderRadius: '30px',
                        overflow: 'hidden',
                        transition: 'background 0.5s ease',
                    }}>
                        {/* Animated progress border */}
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: '30px',
                            background: `conic-gradient(from 0deg, ${timerColor} ${(100 - (currentTimerVal / 20) * 100)}%, transparent ${(100 - (currentTimerVal / 20) * 100)}%)`,
                            mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                            maskComposite: 'exclude',
                            WebkitMaskComposite: 'xor',
                            padding: '3px',
                        }} />
                        <span style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            background: timerColor,
                            boxShadow: `0 0 16px ${timerColor}`,
                            animation: 'pulse 1s ease-in-out infinite',
                            transition: 'background 0.5s ease, box-shadow 0.5s ease',
                        }} />
                        <span style={{
                            fontSize: '1.2rem',
                            fontWeight: 900,
                            color: timerColor,
                            letterSpacing: '2px',
                            fontVariantNumeric: 'tabular-nums',
                            transition: 'color 0.5s ease',
                        }}>
                            00:{currentTimerVal.toString().padStart(2, '0')}
                        </span>
                    </div>

                    {/* Round Info - Shows Question Counter */}
                    <div style={{
                        padding: '0.8rem 2rem',
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '30px',
                        backdropFilter: 'blur(10px)',
                        display: 'flex',
                        alignItems: 'center',
                    }}>
                        <span style={{
                            fontSize: '1.2rem',
                            fontWeight: 800,
                            color: 'rgba(255, 255, 255, 0.8)',
                            letterSpacing: '2px',
                        }}>
                            Quiz Battle · Question {questionNumber || 1}
                        </span>
                    </div>
                </div>

                {/* Question Number - Removed center display, now only in top-right badge */}
            </header>

            <div className="game-arena" ref={arenaRef}>
                {/* Question Display */}
                {question && (
                    <div style={{
                        position: 'absolute',
                        top: '7.5rem',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '90%',
                        maxWidth: '1100px',
                        textAlign: 'center',
                        zIndex: 100,
                        padding: '0 1rem',
                    }}>
                        <h2 style={{
                            fontSize: 'clamp(1.2rem, 2.8vw, 2rem)',
                            fontWeight: 900,
                            color: '#fff',
                            lineHeight: 1.4,
                            margin: 0,
                            textShadow: '0 2px 20px rgba(0,0,0,0.6)',
                        }}>
                            {question.text}
                        </h2>
                        {question.code && (
                            <pre style={{
                                marginTop: '1rem',
                                padding: '1rem',
                                background: 'rgba(0,0,0,0.6)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '12px',
                                color: 'var(--accent-secondary)',
                                fontWeight: 600,
                                fontSize: '0.85rem',
                                fontFamily: 'monospace',
                                overflow: 'auto',
                                maxWidth: '100%',
                            }}>{question.code}</pre>
                        )}
                    </div>
                )}

                {/* Answer Orbs - Pill-shaped with text wrapping */}
                {question?.options.map((opt, i) => {
                    const selectionsForOrb = selectionsMap.get(opt.id) ?? [];

                    const pillGradient = 'linear-gradient(135deg, #8800feff 0%, #d865ecff 100%)';
                    const pillBorder = '2px solid #FFFFFF';

                    return (
                        <div
                            key={opt.id}
                            className={`orb orb-${opt.id.toLowerCase()} ${targetedOrbId === opt.id ? 'targeted' : ''} ${isTransitioning ? 'exit-animation' : 'entry-animation'}`}
                            data-option={opt.id}
                            style={{
                                position: 'absolute',
                                left: ORB_POSITIONS[i].left,
                                top: ORB_POSITIONS[i].top,
                                transform: 'translate(-50%, -50%)',
                                background: pillGradient,
                                padding: '1rem 1.5rem',
                                minWidth: '140px',
                                maxWidth: '280px',
                                borderRadius: '60px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 6px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
                                border: pillBorder,
                                transition: 'all 0.3s ease',
                                cursor: 'pointer',
                                animationDelay: `${i * 0.1}s`,
                            }}
                        >
                            <span style={{
                                fontSize: 'clamp(0.8rem, 1.5vw, 0.95rem)',
                                fontWeight: 700,
                                color: '#fff',
                                textShadow: '0 2px 8px rgba(0,0,0,0.5)',
                                whiteSpace: 'normal',
                                textAlign: 'center',
                                lineHeight: 1.3,
                                maxWidth: '100%',
                                wordBreak: 'normal',
                                overflowWrap: 'anywhere',
                            }}>
                                {opt.text}
                            </span>

                            {/* Player selection indicators */}
                            {selectionsForOrb.length > 0 && (
                                <div style={{
                                    position: 'absolute',
                                    bottom: '-12px',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    display: 'flex',
                                    gap: '4px',
                                }}>
                                    {selectionsForOrb.map(sel => (
                                        <div key={sel.controllerId} style={{
                                            width: '14px',
                                            height: '14px',
                                            borderRadius: '50%',
                                            background: CROSSHAIR_COLORS[sel.colorIndex] || CROSSHAIR_COLORS[0],
                                            border: '2px solid #fff',
                                            boxShadow: `0 0 8px ${CROSSHAIR_COLORS[sel.colorIndex] || CROSSHAIR_COLORS[0]}`,
                                        }} />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Player Avatar Crosshairs - Visible for both singleplayer and multiplayer */}
                {crosshairs.size > 0 && Array.from(crosshairs.entries()).map(([controllerId, crosshairData]) => {
                    const player = lobby?.players.find(p => p.id === controllerId);
                    const colorIndex = player?.colorIndex ?? 0;
                    const color = CROSSHAIR_COLORS[colorIndex];
                    const avatar = PRE_CONFIG_AVATARS[colorIndex];
                    const playerName = player ? PRE_CONFIG_NAMES[colorIndex] : 'Player';

                    return (
                        <div
                            key={controllerId}
                            style={{
                                position: 'absolute',
                                left: `${crosshairData.x}%`,
                                top: `${crosshairData.y}%`,
                                transform: 'translate(-50%, -50%)',
                                width: 'clamp(40px, 8vw, 56px)',
                                height: 'clamp(40px, 8vw, 56px)',
                                pointerEvents: 'none',
                                zIndex: 250,
                                transition: 'left 0.08s linear, top 0.08s linear',
                            }}
                        >
                            <div style={{
                                width: '100%',
                                height: '100%',
                                borderRadius: '50%',
                                border: `2px solid ${color}`,
                                boxShadow: `0 0 12px ${color}80, 0 0 24px ${color}40`,
                                background: 'rgba(15,15,25,0.95)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                overflow: 'visible',
                                position: 'relative',
                            }}>
                                <img
                                    src={`/avatars/${avatar}.png`}
                                    alt={playerName}
                                    style={{ width: '75%', height: '75%', objectFit: 'contain', zIndex: 2 }}
                                />
                                {/* Crosshair lines - extending beyond circle */}
                                <div style={{
                                    position: 'absolute',
                                    width: '100%',
                                    height: '100%',
                                    zIndex: 1,
                                }}>
                                    {/* Vertical line */}
                                    <div style={{
                                        position: 'absolute',
                                        left: '50%',
                                        top: '-30%',
                                        width: '1.5px',
                                        height: '160%',
                                        background: color,
                                        transform: 'translateX(-50%)',
                                        opacity: 0.9,
                                        boxShadow: `0 0 6px ${color}`,
                                    }} />
                                    {/* Horizontal line */}
                                    <div style={{
                                        position: 'absolute',
                                        left: '-30%',
                                        top: '50%',
                                        width: '160%',
                                        height: '1.5px',
                                        background: color,
                                        transform: 'translateY(-50%)',
                                        opacity: 0.9,
                                        boxShadow: `0 0 6px ${color}`,
                                    }} />
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* Bottom Scoreboard - Compact */}
                <div style={{
                    position: 'absolute',
                    bottom: '0',
                    left: '0',
                    right: '0',
                    display: 'flex',
                    background: 'rgba(8,8,16,0.95)',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    zIndex: 200,
                }}>
                    {[0, 1, 2, 3].map((slotIndex) => {
                        const player = lobby?.players.find(p => p.colorIndex === slotIndex);
                        const scoreEntry = playerScores.find(ps => ps.colorIndex === slotIndex);
                        const score = scoreEntry?.score ?? 0;
                        const playerName = PRE_CONFIG_NAMES[slotIndex];
                        const playerColor = CROSSHAIR_COLORS[slotIndex];
                        const hasPlayer = !!player;

                        return (
                            <div key={slotIndex} style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                padding: '0.5rem 0.25rem',
                                borderRight: slotIndex < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                                background: hasPlayer ? `${playerColor}05` : 'transparent',
                            }}>
                                {hasPlayer ? (
                                    <>
                                        <div style={{
                                            width: 'clamp(32px, 6vw, 48px)',
                                            height: 'clamp(32px, 6vw, 48px)',
                                            borderRadius: '50%',
                                            border: `2px solid ${playerColor}`,
                                            boxShadow: `0 0 10px ${playerColor}30`,
                                            background: `${playerColor}15`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            marginBottom: '0.25rem',
                                            overflow: 'hidden',
                                        }}>
                                            <img
                                                src={`/avatars/${PRE_CONFIG_AVATARS[slotIndex]}.png`}
                                                alt={playerName}
                                                style={{ width: '80%', height: '80%', objectFit: 'contain' }}
                                            />
                                        </div>
                                        <span style={{
                                            fontSize: 'clamp(0.65rem, 1.2vw, 0.85rem)',
                                            fontWeight: 800,
                                            color: '#fff',
                                            marginBottom: '0.15rem',
                                        }}>
                                            {playerName}
                                        </span>
                                        <span style={{
                                            fontSize: 'clamp(1.2rem, 2.5vw, 1.6rem)',
                                            fontWeight: 900,
                                            color: playerColor,
                                            fontVariantNumeric: 'tabular-nums',
                                        }}>
                                            {score.toString().padStart(2, '0')}
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <div style={{
                                            width: 'clamp(32px, 6vw, 48px)',
                                            height: 'clamp(32px, 6vw, 48px)',
                                            borderRadius: '50%',
                                            border: '2px dashed rgba(255,255,255,0.15)',
                                            background: 'rgba(255,255,255,0.02)',
                                            marginBottom: '0.25rem',
                                        }} />
                                        <span style={{
                                            fontSize: 'clamp(0.6rem, 1.1vw, 0.75rem)',
                                            fontWeight: 700,
                                            color: 'rgba(255,255,255,0.25)',
                                        }}>
                                            Waiting
                                        </span>
                                        <span style={{
                                            fontSize: 'clamp(1.2rem, 2.5vw, 1.6rem)',
                                            fontWeight: 900,
                                            color: 'rgba(255,255,255,0.15)',
                                        }}>
                                            00
                                        </span>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Particles */}
                {particles.map((p) => (
                    <div key={p.id} className="particle particle-explode" style={{ left: p.x, top: p.y, width: p.size, height: p.size, backgroundColor: p.color, '--tx': p['--tx'], '--ty': p['--ty'] } as React.CSSProperties} />
                ))}

                {/* Score Popups */}
                {scorePopups.map((s) => (
                    <div key={s.id} className={`score-popup ${s.type}`} style={{ left: s.x, top: s.y - 50 }}>{s.text}</div>
                ))}

                {/* Ripples */}
                {ripples.map((r) => (
                    <div key={r.id} className="ripple" style={{ left: r.x - r.size / 2, top: r.y - r.size / 2, width: r.size, height: r.size, border: `3px solid ${r.color}` }} />
                ))}

                {/* Confetti */}
                {confetti.map((c) => (
                    <div key={c.id} className="confetti" style={{ left: c.x, top: c.y, width: c.width, height: c.height, backgroundColor: c.color, '--dx': c['--dx'], '--dy': c['--dy'], '--rot': c['--rot'] } as React.CSSProperties} />
                ))}

                {/* GET READY Overlay - Shows for 2 seconds when transitioning from loading */}
                {showReadyOverlay && (
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
                                            src={`/avatars/${PRE_CONFIG_AVATARS[player.colorIndex ?? 0]}.png`}
                                            alt={PRE_CONFIG_NAMES[player.colorIndex ?? 0]}
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
                                        {PRE_CONFIG_NAMES[player.colorIndex ?? 0]}
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

                        <p style={{
                            fontSize: '1.3rem',
                            color: 'rgba(255,255,255,0.6)',
                            textAlign: 'center',
                        }}>
                            First question incoming
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
});

// ---- Winner_Screen Inline Component ----
interface Winner_ScreenProps {
    gameOverData: GameOverPayload;
}

function Winner_Screen({ gameOverData }: Winner_ScreenProps) {
    return (
        <WinnerScene
            variant="screen"
            scores={gameOverData.playerScores ?? []}
        />
    );
}

// ---- Main ShootQuiz_Screen Component ----
export default function ShootQuiz_Screen() {
    // ---- State ----
    const [phase, setPhase] = useState<GamePhase>('connecting');
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const phaseRef = useRef<GamePhase>('connecting');
    const setPhaseSync = (p: GamePhase) => { phaseRef.current = p; setPhase(p); };
    const [roomId, setRoomId] = useState<string | null>(null);
    const [joinToken, setJoinToken] = useState<string | null>(null);
    const [lobby, setLobby] = useState<LobbyState | null>(null);
    const [question, setQuestion] = useState<ClientQuestion | null>(null);
    const [timeLeft, setTimeLeft] = useState(20);
    const [playerScores, setPlayerScores] = useState<PlayerScoreEntry[]>([]);
    const [gameOverData, setGameOverData] = useState<GameOverPayload | null>(null);

    // Visual effects (client-only)
    const [particles, setParticles] = useState<Particle[]>([]);
    const [scorePopups, setScorePopups] = useState<ScorePopup[]>([]);
    const [ripples, setRipples] = useState<Ripple[]>([]);
    const [confetti, setConfetti] = useState<Confetti[]>([]);
    const [crosshairs, setCrosshairs] = useState<Map<string, { x: number; y: number }>>(new Map());
    const [targetedOrbId, setTargetedOrbId] = useState<string | null>(null);

    const [isTransitioning, setIsTransitioning] = useState(false);
    const [controllerCount, setControllerCount] = useState(0);
    const [sessionEnding, setSessionEnding] = useState(false);

    // Loading screen state
    const [countdownActive, setCountdownActive] = useState(false);
    const [countdownValue, setCountdownValue] = useState(3);
    const [showReadyOverlay, setShowReadyOverlay] = useState(false);

    // Card shuffle reveal state
    const [cardShuffleComplete, setCardShuffleComplete] = useState(false);
    const [qrCardCollapsed, setQrCardCollapsed] = useState(false);

    // Phase-based multiplayer state
    const [phaseTimeLeft, setPhaseTimeLeft] = useState(0);
    const [questionNumber, setQuestionNumber] = useState(0);
    const [playerSelections, setPlayerSelections] = useState<PlayerSelectionPayload[]>([]);

    // Pre-compute selections map for O(1) orb lookup during render
    const selectionsMap = useMemo(() => {
        const map = new Map<string, PlayerSelectionPayload[]>();
        for (const sel of playerSelections) {
            const existing = map.get(sel.orbId);
            if (existing) {
                existing.push(sel);
            } else {
                map.set(sel.orbId, [sel]);
            }
        }
        return map;
    }, [playerSelections]);

    const arenaRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const targetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clientRef = useRef<GameClient | null>(null);
    const hadControllersRef = useRef(false);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gameOverIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const loadingCountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
    const isMultiplayerRef = useRef(false);

    // Topic selection state
    const [topicOrbs, setTopicOrbs] = useState<Array<{ id: string; label: string; emoji: string; x: number; y: number }>>([]);
    const [topicTimeLeft, setTopicTimeLeft] = useState(30);
    const [topicVotedControllerIds, setTopicVotedControllerIds] = useState<string[]>([]);
    const [topicPlayerVotes, setTopicPlayerVotes] = useState<Record<string, string>>({});
    const [topicTotalVoters, setTopicTotalVoters] = useState(0);
    const [topicCrosshairs, setTopicCrosshairs] = useState<Map<string, { x: number; y: number }>>(new Map());
    const [topicDifficulty, setTopicDifficulty] = useState<import('../shared/types').QuizDifficulty>('easy');
    const [selectedTopicLabel, setSelectedTopicLabel] = useState<string | null>(null);
    const topicCountdownStartedRef = useRef(false);

    const scheduleTimeout = useCallback((cb: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
        const timeoutId = setTimeout(() => {
            pendingTimeoutsRef.current.delete(timeoutId);
            cb();
        }, delayMs);
        pendingTimeoutsRef.current.add(timeoutId);
        return timeoutId;
    }, []);

    const clearTrackedTimeout = useCallback((timeoutId: ReturnType<typeof setTimeout> | null) => {
        if (!timeoutId) return;
        clearTimeout(timeoutId);
        pendingTimeoutsRef.current.delete(timeoutId);
    }, []);

    const clearAllScheduledTimeouts = useCallback(() => {
        pendingTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
        pendingTimeoutsRef.current.clear();
    }, []);

    // ---- Visual effect helpers ----

    const createParticles = useCallback((x: number, y: number, count: number, color: string) => {
        const newParticles: Particle[] = [];
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count;
            const distance = 100 + Math.random() * 100;
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance;
            newParticles.push({
                id: `particle-${Date.now()}-${i}`, x, y,
                size: Math.random() * 8 + 4, color,
                '--tx': `${tx}px`, '--ty': `${ty}px`,
            });
        }
        setParticles((prev) => [...prev, ...newParticles]);
        const particleIds = new Set(newParticles.map((p) => p.id));
        scheduleTimeout(() => {
            setParticles((prev) => prev.filter((p) => !particleIds.has(p.id)));
        }, 1000);
    }, [scheduleTimeout]);

    const createScorePopup = useCallback((x: number, y: number, text: string, type: string) => {
        const popupId = `popup-${Date.now()}`;
        setScorePopups((prev) => [...prev, { id: popupId, x, y, text, type }]);
        scheduleTimeout(() => {
            setScorePopups((prev) => prev.filter((p) => p.id !== popupId));
        }, 1500);
    }, [scheduleTimeout]);

    const createRipple = useCallback((x: number, y: number, color: string) => {
        const rippleId = `ripple-${Date.now()}`;
        setRipples((prev) => [...prev, { id: rippleId, x, y, color, size: 60 }]);
        scheduleTimeout(() => {
            setRipples((prev) => prev.filter((r) => r.id !== rippleId));
        }, 1000);
    }, [scheduleTimeout]);

    const createConfetti = useCallback((x: number, y: number) => {
        const newConfetti: Confetti[] = [];
        const colors = ['#6750A4', '#95d4e4', '#FFD8E4', '#ffffff', '#10b981'];
        for (let i = 0; i < 40; i++) {
            const dx = (Math.random() - 0.5) * 500;
            const dy = -Math.random() * 400 - 150;
            const rot = Math.random() * 1080 - 540;
            newConfetti.push({
                id: `confetti-${Date.now()}-${i}`,
                x: x + (Math.random() - 0.5) * 60, y: y + (Math.random() - 0.5) * 60,
                color: colors[Math.floor(Math.random() * colors.length)],
                '--dx': `${dx}px`, '--dy': `${dy}px`, '--rot': `${rot}deg`,
                width: Math.random() * 12 + 6, height: Math.random() * 12 + 6,
            });
        }
        setConfetti((prev) => [...prev, ...newConfetti]);
        const confettiIds = new Set(newConfetti.map((c) => c.id));
        scheduleTimeout(() => {
            setConfetti((prev) => prev.filter((c) => !confettiIds.has(c.id)));
        }, 1800);
    }, [scheduleTimeout]);

    // ---- Handle hit result from server ----
    const handleHitResultRef = useRef<((data: HitResultPayload) => void) | null>(null);

    handleHitResultRef.current = useCallback((data: HitResultPayload) => {
        const { correct, orbId } = data;
        const targetX = orbId
            ? (ORB_POSITIONS.find((o) => o.id === orbId)?.x ?? 50) / 100 * window.innerWidth
            : window.innerWidth / 2;
        const targetY = orbId
            ? (ORB_POSITIONS.find((o) => o.id === orbId)?.y ?? 50) / 100 * window.innerHeight
            : window.innerHeight / 2;

        // Orb animations via DOM
        const orbElements = document.querySelectorAll('.orb');
        const orbClass = correct ? 'correct-answer' : 'wrong-answer';
        orbElements.forEach((orb) => {
            orb.classList.add(orbClass);
            if ((orb as HTMLElement).dataset.option === orbId) {
                orb.classList.add('hit-orb');
            }
        });
        scheduleTimeout(() => {
            orbElements.forEach((orb) => { orb.classList.remove('correct-answer', 'wrong-answer', 'hit-orb'); });
        }, 1200);

        if (correct) {
            createParticles(targetX, targetY, 20, '#10b981');
            createScorePopup(targetX, targetY, `+${data.points}`, 'correct');
            createRipple(targetX, targetY, '#10b981');
            createConfetti(targetX, targetY);

            // Transition animation before next question
            // Exit animation starts at 800ms (0.4s duration), clears at 1200ms
            scheduleTimeout(() => setIsTransitioning(true), 800);
            scheduleTimeout(() => setIsTransitioning(false), 1200);
        } else {
            createParticles(targetX, targetY, 15, '#ef4444');
            createScorePopup(targetX, targetY, '✗', 'wrong');
            createRipple(targetX, targetY, '#ef4444');
        }
    }, [createParticles, createScorePopup, createRipple, createConfetti, scheduleTimeout]);

    // ---- Connect and wire events ----
    useEffect(() => {
        const client = new GameClient();
        clientRef.current = client;

        client.connect().then(() => {
            // Attempt to reconnect to a previous session if we have a stored roomId
            const storedRoomId = sessionStorage.getItem('screen_room_id') || undefined;
            client.createRoom(storedRoomId);

            client.onRoomCreated((data) => {
                setRoomId(data.roomId);
                setJoinToken(data.joinToken);
                // Store roomId on the client for screen reconnect
                client.setScreenRoomId(data.roomId);
                // Persist roomId in sessionStorage for page refresh reconnect
                sessionStorage.setItem('screen_room_id', data.roomId);
                setPhaseSync('qr-lobby');
            });

            client.onLobbyUpdate((data) => {
                setLobby(data);
                setControllerCount(data.players.length);
                const livePhase = phaseRef.current;
                if (data.players.length > 0 && livePhase !== 'playing' && livePhase !== 'game-over' && livePhase !== 'topic-selection' && livePhase !== 'loading') {
                    setPhaseSync('team-lobby');
                } else if (data.players.length === 0 && livePhase === 'team-lobby') {
                    setPhaseSync('qr-lobby');
                }
            });

            client.onControllerJoined((_data) => {
                setControllerCount((prev) => prev + 1);
            });

            client.onControllerLeft((data) => {
                setControllerCount((prev) => Math.max(0, prev - 1));
                if (data.controllerId) {
                    setCrosshairs((prev) => {
                        if (!prev.has(data.controllerId!)) return prev;
                        const next = new Map(prev);
                        next.delete(data.controllerId!);
                        return next;
                    });
                }
            });

            client.onLoadingStart(() => {
                setPhaseSync('loading');
                if (loadingCountdownIntervalRef.current) {
                    clearInterval(loadingCountdownIntervalRef.current);
                    loadingCountdownIntervalRef.current = null;
                }
                setCountdownActive(false);
            });

            client.onLoadingCountdown((data) => {
                setCountdownActive(true);
                setCountdownValue(data.duration);

                if (loadingCountdownIntervalRef.current) {
                    clearInterval(loadingCountdownIntervalRef.current);
                    loadingCountdownIntervalRef.current = null;
                }
                let count = data.duration;
                loadingCountdownIntervalRef.current = setInterval(() => {
                    count--;
                    if (count > 0) {
                        setCountdownValue(count);
                    } else {
                        if (loadingCountdownIntervalRef.current) {
                            clearInterval(loadingCountdownIntervalRef.current);
                            loadingCountdownIntervalRef.current = null;
                        }
                        setCountdownValue(0);
                    }
                }, 1000);
            });

            client.onGameStarted((data) => {
                setQuestion(data.question);
                setTimeLeft(data.timeLeft);
                setPlayerScores([]);
                setQuestionNumber(1);
                setPhaseSync('playing');
                setShowReadyOverlay(true);
                if (loadingCountdownIntervalRef.current) {
                    clearInterval(loadingCountdownIntervalRef.current);
                    loadingCountdownIntervalRef.current = null;
                }
                setCountdownActive(false);
                scheduleTimeout(() => setShowReadyOverlay(false), 2000);
            });

            // Phase-based multiplayer events
            client.onPhaseChange((data) => {
                setPhaseTimeLeft(data.timeLeft);
                setQuestionNumber(data.questionNumber);
                isMultiplayerRef.current = true;
                if (phaseRef.current === 'loading' && (data.phase === 'analysis' || data.phase === 'selection')) {
                    setPhaseSync('playing');
                    setShowReadyOverlay(true);
                    if (loadingCountdownIntervalRef.current) {
                        clearInterval(loadingCountdownIntervalRef.current);
                        loadingCountdownIntervalRef.current = null;
                    }
                    setCountdownActive(false);
                    scheduleTimeout(() => setShowReadyOverlay(false), 2000);
                }
                if (data.phase === 'analysis' && data.timeLeft === 1) {
                    setPlayerSelections([]);
                }
            });

            client.onPlayerSelection((data) => {
                setPlayerSelections((prev) => {
                    const existingIndex = prev.findIndex((selection) => selection.controllerId === data.controllerId);
                    if (existingIndex === -1) {
                        return [...prev, data];
                    }
                    const existing = prev[existingIndex];
                    if (existing.orbId === data.orbId && existing.colorIndex === data.colorIndex) {
                        return prev;
                    }
                    const next = [...prev];
                    next[existingIndex] = data;
                    return next;
                });
            });

            client.onRevealResult((data) => {
                const correctOrb = ORB_POSITIONS.find((o) => o.id === data.correctOrbId);
                const correctX = correctOrb ? (correctOrb.x / 100) * window.innerWidth : window.innerWidth / 2;
                const correctY = correctOrb ? (correctOrb.y / 100) * window.innerHeight : window.innerHeight / 2;

                const orbElements = document.querySelectorAll('.orb');

                if (data.anyCorrect) {
                    // At least one player got it right — normal correct/wrong highlight
                    orbElements.forEach((orb) => {
                        const orbEl = orb as HTMLElement;
                        if (orbEl.dataset.option === data.correctOrbId) {
                            orb.classList.add('correct-answer', 'hit-orb');
                        } else {
                            orb.classList.add('wrong-answer');
                        }
                    });
                    scheduleTimeout(() => {
                        orbElements.forEach((orb) => {
                            orb.classList.remove('correct-answer', 'wrong-answer', 'hit-orb');
                        });
                    }, 2500);

                    createParticles(correctX, correctY, 20, '#10b981');
                    createScorePopup(correctX, correctY, `+${data.points}`, 'correct');
                    createRipple(correctX, correctY, '#10b981');
                    createConfetti(correctX, correctY);

                    scheduleTimeout(() => setIsTransitioning(true), 1800);
                    scheduleTimeout(() => setIsTransitioning(false), 2500);
                } else {
                    // Nobody got it right — dim wrong orbs quietly, reveal correct orb with green glow
                    orbElements.forEach((orb) => {
                        const orbEl = orb as HTMLElement;
                        if (orbEl.dataset.option === data.correctOrbId) {
                            orb.classList.add('reveal-correct-orb');
                        } else {
                            orb.classList.add('wrong-answer-dim');
                        }
                    });
                    scheduleTimeout(() => {
                        orbElements.forEach((orb) => {
                            orb.classList.remove('reveal-correct-orb', 'wrong-answer-dim', 'hit-orb');
                        });
                    }, 2500);

                    createParticles(correctX, correctY, 15, '#ef4444');
                    createScorePopup(correctX, correctY, '✗', 'wrong');
                    createRipple(correctX, correctY, '#ef4444');
                }
            });

            client.onQuestion((data) => {
                setQuestion(data);
                if (!isMultiplayerRef.current) {
                    setQuestionNumber(prev => prev + 1);
                }
            });

            client.onTimerSync((data) => {
                setTimeLeft(data.timeLeft);
            });

            client.onScoreUpdate((data) => {
                setPlayerScores(data.playerScores);
            });

            client.onHitResult((data) => {
                handleHitResultRef.current?.(data);
            });

            client.onCrosshair((data) => {
                if (phaseRef.current === 'topic-selection') {
                    setTopicCrosshairs(prev => {
                        const current = prev.get(data.controllerId);
                        if (current && current.x === data.x && current.y === data.y) {
                            return prev;
                        }
                        const next = new Map(prev);
                        next.set(data.controllerId, { x: data.x, y: data.y });
                        return next;
                    });
                    return;
                }
                setCrosshairs(prev => {
                    const current = prev.get(data.controllerId);
                    if (current && current.x === data.x && current.y === data.y) {
                        return prev;
                    }
                    const next = new Map(prev);
                    next.set(data.controllerId, { x: data.x, y: data.y });
                    return next;
                });
            });

            client.onStartAiming((data) => {
                setCrosshairs(prev => {
                    const next = new Map(prev);
                    next.delete(data.controllerId);
                    return next;
                });
            });

            client.onCancelAiming((data) => {
                setCrosshairs(prev => {
                    const next = new Map(prev);
                    next.delete(data.controllerId);
                    return next;
                });
                setTargetedOrbId(null);
            });

            client.onTargeting((data) => {
                setTargetedOrbId(data.orbId);
                if (targetTimeoutRef.current) {
                    clearTrackedTimeout(targetTimeoutRef.current);
                }
                targetTimeoutRef.current = scheduleTimeout(() => {
                    setTargetedOrbId(null);
                    targetTimeoutRef.current = null;
                }, 500);
            });

            client.onGameOver((data) => {
                setGameOverData(data);
                setPhaseSync('game-over');
                if (gameOverIdleTimerRef.current) {
                    clearTrackedTimeout(gameOverIdleTimerRef.current);
                }
                gameOverIdleTimerRef.current = scheduleTimeout(() => {
                    window.location.reload();
                }, 2 * 60 * 1000);
            });

            client.onRoomExpired((data) => {

                if (data?.reason === 'empty_lobby') {
                    // Empty lobby deleted — clear stored roomId and create a fresh room
                    sessionStorage.removeItem('screen_room_id');
                    client.createRoom();
                } else {
                    // Other expiry (inactivity etc.) — full reload
                    window.location.reload();
                }
            });

            // Topic selection events
            client.onTopicVoteUpdate((data) => {
                if (data.topics && data.topics.length > 0) {
                    setTopicOrbs(data.topics);
                }
                setTopicVotedControllerIds(data.votedControllerIds);
                if (data.playerVotes) setTopicPlayerVotes(data.playerVotes);
                setTopicTotalVoters(data.totalVoters);
                setTopicTimeLeft(data.timeLeft);
                if (data.difficulty) setTopicDifficulty(data.difficulty);

                // Auto-switch to topic-selection phase when first update arrives
                if (phaseRef.current === 'team-lobby' || phaseRef.current === 'qr-lobby') {
                    setPhaseSync('topic-selection');
                }
            });

            client.onTopicSelected((data: TopicSelectedPayload) => {

                setSelectedTopicLabel(data.topicLabel);
                setPhaseSync('loading');
                setTopicCrosshairs(new Map());
            });

            client.onGameRestarted(() => {
                setPhaseSync('team-lobby');
                setQuestion(null);
                setPlayerScores([]);
                setTimeLeft(20);
                setGameOverData(null);
                setPlayerSelections([]);
                isMultiplayerRef.current = false;
                setTopicOrbs([]);
                setTopicTimeLeft(10);
                setTopicVotedControllerIds([]);
                setTopicPlayerVotes({});
                setTopicTotalVoters(0);
                setTopicCrosshairs(new Map());
                setTopicDifficulty('easy');
                setSelectedTopicLabel(null);
                // Cancel any pending game-over idle timer
                if (gameOverIdleTimerRef.current) {
                    clearTrackedTimeout(gameOverIdleTimerRef.current);
                    gameOverIdleTimerRef.current = null;
                }
                if (loadingCountdownIntervalRef.current) {
                    clearInterval(loadingCountdownIntervalRef.current);
                    loadingCountdownIntervalRef.current = null;
                }
                setCountdownActive(false);
            });
        }).catch((err) => {
            console.error('Connection failed:', err);
            setConnectionError(err?.message || 'Failed to connect to server');
        });

        return () => {
            if (loadingCountdownIntervalRef.current) {
                clearInterval(loadingCountdownIntervalRef.current);
                loadingCountdownIntervalRef.current = null;
            }
            if (targetTimeoutRef.current) {
                clearTrackedTimeout(targetTimeoutRef.current);
                targetTimeoutRef.current = null;
            }
            if (idleTimerRef.current) {
                clearTimeout(idleTimerRef.current);
                idleTimerRef.current = null;
            }
            if (gameOverIdleTimerRef.current) {
                clearTrackedTimeout(gameOverIdleTimerRef.current);
                gameOverIdleTimerRef.current = null;
            }
            clearAllScheduledTimeouts();
            client.close();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---- Topic selection countdown timer ----
    useEffect(() => {
        if (phase !== 'topic-selection') {
            topicCountdownStartedRef.current = false;
            setTopicTimeLeft(10);
            return;
        }
        if (topicCountdownStartedRef.current || topicTimeLeft <= 0) return;

        topicCountdownStartedRef.current = true;
        const interval = setInterval(() => {
            setTopicTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(interval);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [phase]);

    // ---- Session Timeout: empty room detection ----
    useEffect(() => {
        if (controllerCount > 0) {
            hadControllersRef.current = true;
        }
        if (hadControllersRef.current && controllerCount === 0 && !sessionEnding
            && phase !== 'connecting' && phase !== 'qr-lobby') {
            setSessionEnding(true);
            scheduleTimeout(() => { window.location.reload(); }, 3000);
        }
    }, [controllerCount, sessionEnding, phase, scheduleTimeout]);

    // ==========================================
    // RENDER — Phase routing
    // ==========================================

    // ---- Session Ending (scorecard before refresh) ----
    if (sessionEnding) {
        return (
            <div className="screen-container">
                <div
                    style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        height: '100vh', textAlign: 'center',
                        animation: 'bounceIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                >
                    <div style={{
                        background: 'var(--glass-bg)', padding: '3rem', borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--glass-border)', backdropFilter: 'blur(20px)',
                        boxShadow: 'var(--glass-glow)', minWidth: '400px',
                    }}>
                        <h1 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#fff', marginBottom: '0.5rem' }}>
                            Session Ended
                        </h1>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontSize: '1rem' }}>
                            All players have left
                        </p>
                        {playerScores.length > 0 && (
                            <div style={{ marginBottom: '1.5rem' }}>
                                <h3 style={{ color: 'var(--accent-secondary)', fontWeight: 700, marginBottom: '1rem', fontSize: '1rem' }}>Final Scores</h3>
                                {playerScores.map((ps, idx) => (
                                    <div key={ps.controllerId} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '0.5rem 1rem', marginBottom: '0.25rem', borderRadius: '8px',
                                        background: idx === 0 ? 'rgba(103, 80, 164, 0.2)' : 'rgba(255,255,255,0.03)',
                                    }}>
                                        <span style={{ fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{
                                                width: '10px', height: '10px', borderRadius: '50%',
                                                background: CROSSHAIR_COLORS[ps.colorIndex] || CROSSHAIR_COLORS[0],
                                                boxShadow: `0 0 6px ${CROSSHAIR_COLORS[ps.colorIndex] || CROSSHAIR_COLORS[0]}`,
                                            }} />
                                            {idx === 0 ? '🏆' : `#${idx + 1}`} {ps.name}
                                        </span>
                                        <span style={{ color: 'var(--accent-secondary)', fontWeight: 800 }}>{ps.score} pts</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div style={{
                            padding: '0.75rem 2rem', background: 'rgba(255,255,255,0.05)',
                            borderRadius: 'var(--radius-md)', border: '1px solid var(--glass-border)',
                        }}>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 600 }}>
                                🔄 Resetting in a moment...
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ---- Connecting ----
    if (phase === 'connecting') {
        return <LandingPage connectionError={connectionError} roomId={roomId} joinToken={joinToken} lobby={lobby} />;
    }

    // ---- Game Lobby ----
    if (phase === 'qr-lobby' || phase === 'team-lobby') {
        return (
            <GameLobby_Screen
                roomId={roomId}
                joinToken={joinToken}
                lobby={lobby}
                phase={phase}
                cardShuffleComplete={cardShuffleComplete}
                qrCardCollapsed={qrCardCollapsed}
                setCardShuffleComplete={setCardShuffleComplete}
                setQrCardCollapsed={setQrCardCollapsed}
            />
        );
    }

    // ---- Topic Selection ----
    if (phase === 'topic-selection') {
        return (
            <TopicSelection_Screen
                lobby={lobby}
                topicOrbs={topicOrbs}
                votedControllerIds={topicVotedControllerIds}
                playerVotes={topicPlayerVotes}
                totalVoters={topicTotalVoters}
                timeLeft={topicTimeLeft}
                crosshairs={topicCrosshairs}
                difficulty={topicDifficulty}
            />
        );
    }

    // ---- Loading ----
    if (phase === 'loading') {
        return (
            <Loading_Screen
                lobby={lobby}
                countdownActive={countdownActive}
                countdownValue={countdownValue}
                showReadyOverlay={showReadyOverlay}
                selectedTopicLabel={selectedTopicLabel}
            />
        );
    }

    // ---- Game Over / Exit Scores ----
    if ((phase === 'game-over' || phase === 'exit-scores') && gameOverData) {
        return <Winner_Screen gameOverData={gameOverData} />;
    }

    // ---- Playing (Game Arena) ----
    if (phase === 'playing') {
        return (
            <GamePlay_Screen
                containerRef={containerRef}
                arenaRef={arenaRef}
                question={question}
                timeLeft={timeLeft}
                phaseTimeLeft={phaseTimeLeft}
                questionNumber={questionNumber}
                isTransitioning={isTransitioning}
                showReadyOverlay={showReadyOverlay}
                targetedOrbId={targetedOrbId}
                selectionsMap={selectionsMap}
                crosshairs={crosshairs}
                lobby={lobby}
                playerScores={playerScores}
                particles={particles}
                scorePopups={scorePopups}
                ripples={ripples}
                confetti={confetti}
            />
        );
    }

    // ---- Fallback ----
    return <LandingPage connectionError={null} roomId={roomId} joinToken={joinToken} lobby={lobby} />;
}