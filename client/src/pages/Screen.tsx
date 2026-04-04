// ==========================================
// Screen Page — Presentation Layer
// Displays game arena, questions, effects
// ALL logic comes from server events
// ==========================================

import { useEffect, useState, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { GameClient } from '../transport/GameClient';
import backgroundVideo from '../assets/QuizWall.webm';
import { ORB_POSITIONS, CROSSHAIR_COLORS } from '../shared/types';
import type {
    ClientQuestion,
    HitResultPayload,
    LobbyState,
    GameOverPayload,
    LeaderboardEntry,
    QuestionPhase,
    PlayerSelectionPayload,
    PlayerScoreEntry,
    RevealResultPayload,
} from '../shared/types';
import '../animations.css';

type GamePhase = 'connecting' | 'qr-lobby' | 'team-lobby' | 'tutorial' | 'playing' | 'game-over' | 'exit-scores';

interface Particle { id: string; x: number; y: number; size: number; color: string; '--tx': string; '--ty': string; }
interface ScorePopup { id: string; x: number; y: number; text: string; type: string; }
interface Ripple { id: string; x: number; y: number; color: string; size: number; }
interface Confetti { id: string; x: number; y: number; color: string; '--dx': string; '--dy': string; '--rot': string; width: number; height: number; }
interface Projectile { id: string; x: number; y: number; targetX: number; targetY: number; }

export default function Screen() {
    // ---- State ----
    const [phase, setPhase] = useState<GamePhase>('connecting');
    const [connectionError, setConnectionError] = useState<string | null>(null);
    // Keep a ref in sync for use inside event-handler closures (avoids stale state reads)
    const phaseRef = useRef<GamePhase>('connecting');
    const setPhaseSync = (p: GamePhase) => { phaseRef.current = p; setPhase(p); };
    const [roomId, setRoomId] = useState<string | null>(null);
    const [joinToken, setJoinToken] = useState<string | null>(null);
    const [lobby, setLobby] = useState<LobbyState | null>(null);
    const [question, setQuestion] = useState<ClientQuestion | null>(null);
    const [timeLeft, setTimeLeft] = useState(20);
    const [playerScores, setPlayerScores] = useState<PlayerScoreEntry[]>([]);
    const [gameOverData, setGameOverData] = useState<GameOverPayload | null>(null);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

    // Visual effects (client-only)
    const [projectiles, setProjectiles] = useState<Projectile[]>([]);
    const [hitEffects, setHitEffects] = useState<{ id: string; x: number; y: number; correct: boolean }[]>([]);
    const [particles, setParticles] = useState<Particle[]>([]);
    const [scorePopups, setScorePopups] = useState<ScorePopup[]>([]);
    const [ripples, setRipples] = useState<Ripple[]>([]);
    const [confetti, setConfetti] = useState<Confetti[]>([]);
    const [crosshairs, setCrosshairs] = useState<Map<string, { x: number; y: number }>>(new Map());
    const [targetedOrbId, setTargetedOrbId] = useState<string | null>(null);

    // Per-player crosshair colors — imported from shared types
    // Store color index from server when controller joins
    const crosshairColorMap = useRef<Map<string, number>>(new Map());
    const getPlayerColor = useCallback((controllerId: string): string => {
        const colorIndex = crosshairColorMap.current.get(controllerId) ?? 0;
        return CROSSHAIR_COLORS[colorIndex] || CROSSHAIR_COLORS[0];
    }, []);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [controllerCount, setControllerCount] = useState(0);
    const [sessionEnding, setSessionEnding] = useState(false);

    // Phase-based multiplayer state
    const [currentPhase, setCurrentPhase] = useState<QuestionPhase | null>(null);
    const [phaseTimeLeft, setPhaseTimeLeft] = useState(0);
    const [questionNumber, setQuestionNumber] = useState(0);
    const [playerSelections, setPlayerSelections] = useState<PlayerSelectionPayload[]>([]);
    const [revealResult, setRevealResult] = useState<RevealResultPayload | null>(null);
    const [isMultiplayer, setIsMultiplayer] = useState(false);

    // Tutorial state removed

    const arenaRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const targetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clientRef = useRef<GameClient | null>(null);
    const hadControllersRef = useRef(false);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gameOverIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    // ---- Visual effect helpers (identical to original) ----

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
        setTimeout(() => { setParticles((prev) => prev.filter((p) => !newParticles.some((np) => np.id === p.id))); }, 1000);
    }, []);

    const createScorePopup = useCallback((x: number, y: number, text: string, type: string) => {
        const popupId = `popup-${Date.now()}`;
        setScorePopups((prev) => [...prev, { id: popupId, x, y, text, type }]);
        setTimeout(() => { setScorePopups((prev) => prev.filter((p) => p.id !== popupId)); }, 1500);
    }, []);

    const createRipple = useCallback((x: number, y: number, color: string) => {
        const rippleId = `ripple-${Date.now()}`;
        setRipples((prev) => [...prev, { id: rippleId, x, y, color, size: 60 }]);
        setTimeout(() => { setRipples((prev) => prev.filter((r) => r.id !== rippleId)); }, 1000);
    }, []);

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
        setTimeout(() => { setConfetti((prev) => prev.filter((c) => !newConfetti.some((nc) => nc.id === c.id))); }, 1800);
    }, []);

    // ---- Handle hit result from server (triggers all visual effects) ----
    const handleHitResultRef = useRef<((data: HitResultPayload) => void) | null>(null);

    handleHitResultRef.current = useCallback((data: HitResultPayload) => {
        const { correct, orbId } = data;
        const targetX = orbId
            ? (ORB_POSITIONS.find((o) => o.id === orbId)?.x ?? 50) / 100 * window.innerWidth
            : window.innerWidth / 2;
        const targetY = orbId
            ? (ORB_POSITIONS.find((o) => o.id === orbId)?.y ?? 50) / 100 * window.innerHeight
            : window.innerHeight / 2;

        // Hit effect on orb
        const hitId = `hit-${Date.now()}`;
        setHitEffects((prev) => [...prev, { id: hitId, x: targetX, y: targetY, correct }]);
        setTimeout(() => { setHitEffects((prev) => prev.filter((e) => e.id !== hitId)); }, 500);

        // Orb animations via DOM
        const orbElements = document.querySelectorAll('.orb');
        const orbClass = correct ? 'correct-answer' : 'wrong-answer';
        orbElements.forEach((orb) => {
            orb.classList.add(orbClass);
            if ((orb as HTMLElement).dataset.option === orbId) {
                orb.classList.add('hit-orb');
            }
        });
        setTimeout(() => {
            orbElements.forEach((orb) => { orb.classList.remove('correct-answer', 'wrong-answer', 'hit-orb'); });
        }, 1200);

        if (correct) {
            createParticles(targetX, targetY, 20, '#10b981');
            createScorePopup(targetX, targetY, `+${data.points}`, 'correct');
            createRipple(targetX, targetY, '#10b981');
            createConfetti(targetX, targetY);

            // Transition animation before next question
            setTimeout(() => setIsTransitioning(true), 800);
            setTimeout(() => setIsTransitioning(false), 1500);
        } else {
            createParticles(targetX, targetY, 15, '#ef4444');
            createScorePopup(targetX, targetY, '✗', 'wrong');
            createRipple(targetX, targetY, '#ef4444');
        }
    }, [createParticles, createScorePopup, createRipple, createConfetti]);

    // ---- Connect and wire events ----
    useEffect(() => {
        const client = new GameClient();
        clientRef.current = client;

        client.connect().then(() => {
            client.createRoom();

            client.onRoomCreated((data) => {
                setRoomId(data.roomId);
                setJoinToken(data.joinToken);
                if (data.leaderboard) setLeaderboard(data.leaderboard);
                setPhaseSync('qr-lobby');
            });

            client.onLobbyUpdate((data) => {
                setLobby(data);
                setControllerCount(data.players.length);
                // Use phaseRef.current (not stale 'phase' closure) to avoid switching away from gameplay
                const livePhase = phaseRef.current;
                if (data.players.length > 0 && livePhase !== 'playing' && livePhase !== 'game-over') {
                    setPhaseSync('team-lobby');
                }
            });

            client.onControllerJoined((data) => {
                setControllerCount((prev) => prev + 1);
                // Store the color index from server for this controller
                crosshairColorMap.current.set(data.controllerId, data.colorIndex ?? 0);
            });

            client.onControllerLeft((data) => {
                setControllerCount((prev) => Math.max(0, prev - 1));
                console.log('Controller left:', data.controllerId);
            });

client.onTutorialStart((_data: { duration: number }) => {
                console.log('[Screen] Loading questions...');
                setPhaseSync('tutorial');
            });

            client.onTutorialEnd(() => {
                console.log('[Screen] Tutorial ended, waiting for game data...');
            });

            client.onTutorialEnd(() => {
                console.log('[Screen] Tutorial ended, waiting for game data...');
                // Phase will change to 'playing' when GAME_STARTED arrives
            });

            client.onGameStarted((data) => {
                console.log('[Screen] Game Started event received:', data);
                setQuestion(data.question);
                setTimeLeft(data.timeLeft);
                setPlayerScores([]);
                setQuestionNumber(1);
                setPhaseSync('playing');
            });

            // Phase-based multiplayer events
            client.onPhaseChange((data) => {
                setCurrentPhase(data.phase);
                setPhaseTimeLeft(data.timeLeft);
                setQuestionNumber(data.questionNumber);
                setIsMultiplayer(true);
                // Clear selections when entering analysis phase (new question)
                if (data.phase === 'analysis' && data.timeLeft === 1) {
                    setPlayerSelections([]);
                    setRevealResult(null);
                }
            });

            client.onPlayerSelection((data) => {
                setPlayerSelections(prev => [...prev, data]);
            });

            client.onRevealResult((data) => {
                setRevealResult(data);

                // Trigger the classic correct/wrong orb animations
                const correctOrb = ORB_POSITIONS.find((o) => o.id === data.correctOrbId);
                const correctX = correctOrb ? (correctOrb.x / 100) * window.innerWidth : window.innerWidth / 2;
                const correctY = correctOrb ? (correctOrb.y / 100) * window.innerHeight : window.innerHeight / 2;

                // Orb DOM class animations
                const orbElements = document.querySelectorAll('.orb');
                orbElements.forEach((orb) => {
                    const orbEl = orb as HTMLElement;
                    if (orbEl.dataset.option === data.correctOrbId) {
                        orb.classList.add('correct-answer', 'hit-orb');
                    } else {
                        orb.classList.add('wrong-answer');
                    }
                });
                setTimeout(() => {
                    orbElements.forEach((orb) => {
                        orb.classList.remove('correct-answer', 'wrong-answer', 'hit-orb');
                    });
                }, 2500);

                if (data.anyCorrect) {
                    createParticles(correctX, correctY, 20, '#10b981');
                    createScorePopup(correctX, correctY, `+${data.points}`, 'correct');
                    createRipple(correctX, correctY, '#10b981');
                    createConfetti(correctX, correctY);

                    // Transition animation before next question
                    setTimeout(() => setIsTransitioning(true), 1800);
                    setTimeout(() => setIsTransitioning(false), 2500);
                } else {
                    createParticles(correctX, correctY, 15, '#ef4444');
                    createScorePopup(correctX, correctY, '✗', 'wrong');
                    createRipple(correctX, correctY, '#ef4444');
                }
            });

            client.onQuestion((data) => {
                setQuestion(data);
                // Increment question counter for singleplayer
                if (!isMultiplayer) {
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

            client.onProjectile((data) => {
                const id = `shot-${Date.now()}`;
                const targetX = (data.targetXPercent / 100) * window.innerWidth;
                const targetY = (data.targetYPercent / 100) * window.innerHeight;
                setProjectiles((prev) => [...prev, { id, x: window.innerWidth / 2, y: window.innerHeight, targetX, targetY }]);
                setTimeout(() => { setProjectiles((prev) => prev.filter((p) => p.id !== id)); }, 300);
            });

            client.onCrosshair((data) => {
                setCrosshairs(prev => {
                    const next = new Map(prev);
                    next.set(data.controllerId, { x: data.x, y: data.y });
                    return next;
                });
            });

            client.onStartAiming((data) => {
                // Always remove crosshair when starting to aim (touch-based aiming only)
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
                if (targetTimeoutRef.current) clearTimeout(targetTimeoutRef.current);
                targetTimeoutRef.current = setTimeout(() => setTargetedOrbId(null), 500);
            });

            client.onGameOver((data) => {
                setGameOverData(data);
                if (data.leaderboard) setLeaderboard(data.leaderboard);
                setPhaseSync('game-over');
                // Start 60-second idle timer: if nobody interacts, reload after 1 min
                if (gameOverIdleTimerRef.current) clearTimeout(gameOverIdleTimerRef.current);
                gameOverIdleTimerRef.current = setTimeout(() => {
                    console.log('[Screen] Game-over idle timeout (1 min), refreshing...');
                    window.location.reload();
                }, 60 * 1000);
            });

            client.onGameRestarted(() => {
                setPhaseSync('team-lobby');
                setQuestion(null);
                setPlayerScores([]);
                setTimeLeft(20);
                setGameOverData(null);
                setPlayerSelections([]);
                setRevealResult(null);
                setCurrentPhase(null);
                setIsMultiplayer(false);
                // Cancel any pending game-over idle timer
                if (gameOverIdleTimerRef.current) { clearTimeout(gameOverIdleTimerRef.current); gameOverIdleTimerRef.current = null; }
            });
        }).catch((err) => {
            console.error('Connection failed:', err);
            setConnectionError(err?.message || 'Failed to connect to server');
        });

        return () => { client.close(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const controllerUrl = roomId && joinToken ? `${window.location.origin}/controller/${roomId}/${joinToken}` : '';

    // ---- Session Timeout: empty room detection ----
    useEffect(() => {
        if (controllerCount > 0) {
            hadControllersRef.current = true;
        }
        // End session if ALL controllers leave (including during gameplay)
        if (hadControllersRef.current && controllerCount === 0 && !sessionEnding
            && phase !== 'connecting' && phase !== 'qr-lobby') {
            setSessionEnding(true);
            setTimeout(() => { window.location.reload(); }, 3000);
        }
    }, [controllerCount, sessionEnding, phase]);

    // ---- Session Timeout: 2-minute lobby idle ----
    useEffect(() => {
        // Only active in lobby phases
        if (phase !== 'qr-lobby' && phase !== 'team-lobby') {
            if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
            return;
        }
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
            console.log('[Screen] Lobby idle timeout (2 min), refreshing...');
            window.location.reload();
        }, 2 * 60 * 1000);
        return () => { if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; } };
    }, [phase, lobby]);

    // ---- Video Optimization: Ensure smooth playback ----
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Force video to play and handle any interruptions
        const playVideo = async () => {
            try {
                if (video.paused) {
                    await video.play().catch(() => {
                        // Ignore autoplay restrictions
                    });
                }
            } catch (err) {
                // Silently handle playback errors
            }
        };

        // Start playing
        playVideo();

        // Ensure video keeps playing through phase transitions
        video.addEventListener('ended', playVideo);
        video.addEventListener('pause', playVideo);

        // Preload video data for smooth playback
        video.load();

        return () => {
            video.removeEventListener('ended', playVideo);
            video.removeEventListener('pause', playVideo);
        };
    }, [phase]);

    // ==========================================
    // RENDER — preserving existing UI/UX exactly
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

    // ---- Game Over ----
    if (phase === 'game-over' && gameOverData) {
        const isCompleted = gameOverData.reason === 'completed';
        const hasPlayerScores = gameOverData.playerScores && gameOverData.playerScores.length > 0;
        return (
            <div className="screen-container">
                <div
                    className="game-over-screen"
                    style={{
                        display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        height: '100vh',
                        animation: 'bounceIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        position: 'relative', scale: '0.8',
                        gap: '3rem', padding: '2rem',
                    }}
                >
                    {/* LEFT SIDE — Player Scoreboard */}
                    {hasPlayerScores && (
                        <div style={{
                            display: 'flex', flexDirection: 'column', gap: '1rem',
                            minWidth: '280px', maxWidth: '320px', alignSelf: 'center',
                        }}>
                            <div style={{
                                background: 'var(--glass-bg)', padding: '1.5rem', borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--glass-border)', backdropFilter: 'blur(20px)',
                                boxShadow: 'var(--glass-glow)',
                            }}>
                                <h3 style={{ color: '#90e0ef', fontWeight: 800, marginBottom: '1rem', fontSize: '1.1rem', letterSpacing: '2px', textTransform: 'uppercase', textAlign: 'center' }}>Player Scoreboard</h3>
                                {gameOverData.playerScores!.map((ps, idx) => (
                                    <div key={ps.controllerId} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '0.7rem 1rem', marginBottom: '0.35rem', borderRadius: '10px',
                                        background: idx === 0 ? 'rgba(103, 80, 164, 0.2)' : 'rgba(255,255,255,0.03)',
                                        border: idx === 0 ? '1px solid rgba(103, 80, 164, 0.4)' : '1px solid transparent',
                                    }}>
                                        <span style={{ fontWeight: 700, fontSize: '1rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{
                                                width: '10px', height: '10px', borderRadius: '50%',
                                                background: CROSSHAIR_COLORS[ps.colorIndex] || CROSSHAIR_COLORS[0],
                                                boxShadow: `0 0 6px ${CROSSHAIR_COLORS[ps.colorIndex] || CROSSHAIR_COLORS[0]}`,
                                            }} />
                                            {idx === 0 ? '🏆' : `#${idx + 1}`} {ps.name}
                                        </span>
                                        <span style={{ color: 'var(--accent-secondary)', fontWeight: 800, fontSize: '1rem' }}>
                                            {ps.score} pts
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* CENTER — Main Content */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                        <h1 style={{
                            fontSize: isCompleted ? '3.5rem' : '5rem',
                            fontWeight: '900',
                            color: isCompleted ? '#10b981' : '#ff4444',
                            textShadow: isCompleted ? '0 0 40px rgba(16, 185, 129, 0.5)' : '0 0 40px rgba(255, 0, 0, 0.5)',
                            marginBottom: '0.5rem',
                            lineHeight: 1.2,
                        }}>
                            {isCompleted ? 'ALL QUESTIONS COMPLETED!' : "TIME'S UP!"}
                        </h1>

                        {isCompleted && (
                            <p style={{ fontSize: '1.2rem', color: '#90e0ef', marginBottom: '1rem' }}>
                                Great job! You answered all 10 questions.
                            </p>
                        )}

                        <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '2.5rem', borderRadius: '30px', border: '1px solid rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(20px)', minWidth: '350px', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'rgba(255, 255, 255, 0.8)', fontWeight: '600' }}>Final Score</h2>
                            <p style={{ fontSize: '4.5rem', fontWeight: '900', color: '#90e0ef', margin: 0 }}>{gameOverData.playerScores?.[0]?.score ?? 0}</p>
                            <p style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                                Questions answered: {gameOverData.questionsAnswered}/10
                            </p>
                        </div>

                        {/* Historical Leaderboard - Hidden per user request */}

                        {/* Controller Actions Indicator */}
                        <div style={{
                            background: 'var(--glass-bg)',
                            padding: '1rem 2rem',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--glass-border)',
                            marginTop: '1rem'
                        }}>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: 600 }}>
                                📱 Use your controller to <span style={{ color: 'var(--accent-primary)' }}>Play Again</span> or <span style={{ color: 'var(--accent-secondary)' }}>Close</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ---- LOBBY PHASES (qr-lobby and team-lobby combined for seamless video transition) ----
    if (phase === 'qr-lobby' || phase === 'team-lobby') {
        const isTeamLobby = phase === 'team-lobby' && (lobby?.players.length ?? 0) > 0;
        const preConfigNames = ["Wulf", "Talon", "Ryker", "Roux"];
        const preConfigAvatars = ["wulf", "talon", "ryker", "roux"];

        return (
            <div className="saas-landing-screen" style={{ background: '#0D0D12' }}>
                {/* Background Video - optimized for smooth playback */}
                <video 
                    ref={videoRef}
                    className="landing-bg-video" 
                    autoPlay 
                    loop 
                    muted 
                    playsInline
                    preload="auto"
                    disablePictureInPicture
                >
                    <source src={backgroundVideo} type="video/webm" />
                </video>
                <div className="landing-bg-overlay" />
                
                {isTeamLobby ? (
                    <div className="lobby-overlay" style={{ background: 'transparent' }}>
                        <div className="lobby-header" style={{ top: '6%' }}>
                            <div className="saas-title lobby-screen-title">Game Lobby</div>
                        </div>

                        <div className="lobby-content" style={{ justifyContent: 'flex-start', paddingRight: '0', paddingLeft: '12%' }}>
                            <div className="lobby-players-grid" style={{ flex: 'none', width: 'auto', gap: '1rem', justifySelf: 'center' }}>
                                {[0, 1, 2, 3].map(slotIndex => {
                                    const player = lobby?.players[slotIndex];
                                    const name = preConfigNames[slotIndex];
                                    const avatar = preConfigAvatars[slotIndex];
                                    const isJoined = !!player;
                                    const uiColor = isJoined 
                                        ? (CROSSHAIR_COLORS[player?.colorIndex ?? slotIndex] || CROSSHAIR_COLORS[0])
                                        : 'rgba(255, 255, 255, 0.15)';

                                    return (
                                        <div 
                                            key={slotIndex} 
                                            className={`lobby-card-v2 ${isJoined ? 'is-joined' : 'is-empty'}`}
                                            style={{ 
                                                '--card-color': uiColor,
                                                borderColor: uiColor,
                                                width: '180px',
                                                height: '280px',
                                                animationDelay: `${slotIndex * 0.1}s`
                                            } as React.CSSProperties}
                                        >
                                            <div className="card-avatar-wrapper" style={{ width: '110px', height: '110px', marginBottom: '1rem' }}>
                                                <img 
                                                    src={`/avatars/${avatar}.png`} 
                                                    alt={name} 
                                                    className="lobby-avatar-v2" 
                                                    style={{ width: '120px', height: '120px', opacity: isJoined ? 1 : 0.35 }}
                                                />
                                            </div>
                                            
                                            <div className="card-info">
                                                <div className="lobby-name-v2" style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>{name}</div>
                                                {isJoined ? (
                                                    player.isReady ? (
                                                        <div className="status-badge ready" style={{ fontSize: '0.7rem' }}>READY</div>
                                                    ) : (
                                                        <div className="status-badge joined" style={{ fontSize: '0.7rem' }}>JOINED</div>
                                                    )
                                                ) : (
                                                    <div className="status-badge empty" style={{ fontSize: '0.7rem' }}>CONNECTING...</div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="saas-landing-left" style={{ position: 'absolute', top: 0, left: 0, height: '100%' }}>
                        <div className="saas-title">
                            Play Together<br />
                            <span className="saas-title-highlight">Instantly</span>
                        </div>

                        <div className="saas-brand-thumbnail">
                            QUIZ<br />WALL
                        </div>
                    </div>
                )}

                {/* FIXED QR CONTAINER on the RIGHT side - ensure it doesn't cover cards */}
                <div className="saas-fixed-right-container" style={{ right: '4%' }}>
                    <div className="saas-qr-glass-card" style={{ scale: '0.9' }}>
                        <div className="saas-qr-wrapper">
                            <QRCodeSVG value={controllerUrl} size={180} level="H" fgColor="#1c1b1f" />
                        </div>
                        <div className="saas-scan-prompt" style={{ fontSize: '0.75rem' }}>
                            <i>{isTeamLobby ? '📱' : '🎯'}</i> 
                            {isTeamLobby ? <span>Scan to Join</span> : <span>Scan to be <br />lobby leader</span>}
                        </div>
                    </div>
                </div>

                {!isTeamLobby && (
                    <div className="saas-player-badge">
                        <i>👥</i> 1 - 4 players
                    </div>
                )}
            </div>
        );
    }

    // ---- Loading Questions Phase ----
    if (phase === 'tutorial') {
        const myColor = '#6750A4'; // Use primary accent color for loading

        return (
            <div className="screen-container" style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                height: '100vh', background: 'linear-gradient(135deg, #1C1B1F 0%, #2D2C31 100%)',
                padding: '2rem',
            }}>
                <div style={{
                    background: 'var(--glass-bg)', padding: '3rem',
                    borderRadius: 'var(--radius-lg)', border: '1px solid var(--glass-border)',
                    backdropFilter: 'blur(20px)', maxWidth: '400px', width: '100%',
                    textAlign: 'center', boxShadow: 'var(--glass-glow)',
                    animation: 'bounceIn 0.5s ease-out',
                }}>
                    <div style={{
                        width: '60px', height: '60px', margin: '0 auto 2rem',
                        border: '4px solid rgba(255,255,255,0.1)', borderTop: `4px solid ${myColor}`,
                        borderRadius: '50%', animation: 'spin 1s linear infinite',
                        boxShadow: `0 0 20px ${myColor}30`,
                    }} />
                    <h2 style={{ fontSize: '2rem', fontWeight: 900, color: '#fff', margin: '0 0 1rem' }}>Loading Questions...</h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>
                        AI is generating your questions
                    </p>
                    <div style={{
                        marginTop: '2rem', padding: '0.75rem',
                        background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-md)',
                        fontSize: '0.9rem', color: 'var(--accent-secondary)', fontWeight: 600
                    }}>
                        Get Ready! 🚀
                    </div>
                </div>
            </div>
        );
    }

    // ---- Playing (Game Arena) ----
    // Phase-aware header: multiplayer shows phase indicator and phase timer; singleplayer shows classic timer
    const phaseLabel = currentPhase === 'analysis' ? '🔍 ANALYZE' : currentPhase === 'selection' ? '🎯 SELECT NOW!' : currentPhase === 'reveal' ? '✨ REVEAL' : '';
    const phaseColor = currentPhase === 'analysis' ? 'var(--accent-primary)' : currentPhase === 'selection' ? '#ff9500' : currentPhase === 'reveal' ? 'var(--accent-success)' : 'var(--accent-primary)';

    return (
        <div className="screen-container" ref={containerRef}>
            <header className="screen-header">
                <div className="player-count-badge">
                    <span style={{ fontSize: '1.2rem', filter: 'drop-shadow(0 0 0.6rem rgba(103, 80, 164, 0.5))' }}>👥</span>
                    <span style={{ fontWeight: '900', color: 'var(--text-primary)', fontSize: '1.4rem' }}>{controllerCount}</span>
                    <div style={{ display: 'flex', gap: '1.25rem', borderLeft: '2px solid var(--glass-border)', paddingLeft: '1.25rem', marginLeft: '0.5rem' }}>
                        {playerScores.length > 0 ? (
                            playerScores.map((ps) => (
                                <span key={ps.controllerId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{
                                        width: '10px', height: '10px', borderRadius: '50%',
                                        background: CROSSHAIR_COLORS[ps.colorIndex] || CROSSHAIR_COLORS[0],
                                        boxShadow: `0 0 6px ${CROSSHAIR_COLORS[ps.colorIndex] || CROSSHAIR_COLORS[0]}`,
                                    }} />
                                    <span style={{ color: 'var(--accent-secondary)', fontWeight: 700, fontSize: '0.9rem' }}>{ps.name}</span>
                                    <span style={{ color: 'var(--accent-secondary)', fontWeight: 800, fontSize: '1.1rem' }}>{ps.score}</span>
                                </span>
                            ))
                        ) : (
                            <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.9rem' }}>
                                Waiting for scores...
                            </span>
                        )}
                    </div>
                </div>

                {/* Timer Bar / Phase Indicator — phase-aware for multiplayer, classic for singleplayer */}
                {isMultiplayer && currentPhase ? (
                    <>
                        {/* Premium Phase & Timer HUD */}
                        <div style={{ position: 'absolute', top: '2rem', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '0.4rem', borderRadius: 'var(--radius-full)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(16px)', boxShadow: 'var(--glass-glow)', zIndex: 1000, gap: '1rem' }}>
                            <div style={{
                                padding: '0.5rem 1.5rem', borderRadius: 'var(--radius-full)',
                                background: phaseColor, color: '#fff',
                                fontWeight: 900, fontSize: '1rem', letterSpacing: '0.15rem',
                                boxShadow: `0 4px 15px ${phaseColor}40`,
                                animation: currentPhase === 'selection' ? 'pulse 1.2s ease-in-out infinite' : 'none',
                                display: 'flex', alignItems: 'center', gap: '0.5rem'
                            }}>
                                {phaseLabel}
                            </div>
                            <span style={{ fontSize: '1.8rem', fontWeight: '900', color: phaseTimeLeft <= 3 ? '#ff4444' : '#fff', paddingRight: '1.25rem', minWidth: '3.5rem', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                                {phaseTimeLeft}s
                            </span>
                        </div>
                    </>
                ) : (
                    <>
                        <div style={{ position: 'absolute', top: '0', left: '0', width: '100%', height: '0.5rem', background: 'rgba(255,255,255,0.1)', zIndex: 1000 }}>
                            <div style={{ width: `${(timeLeft / 20) * 100}%`, height: '100%', background: timeLeft <= 10 ? 'var(--accent-error)' : 'var(--accent-primary)', transition: 'width 1s linear, background 0.3s ease', boxShadow: `0 0 1.25rem ${timeLeft <= 10 ? 'var(--accent-error)' : 'var(--accent-primary)'}` }} />
                        </div>
                        <div style={{ position: 'absolute', top: '2rem', left: '50%', transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.05)', padding: '0.6rem 2rem', borderRadius: 'var(--radius-full)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(16px)', boxShadow: 'var(--glass-glow)', fontSize: '1.8rem', fontWeight: '900', color: timeLeft <= 10 ? 'var(--accent-error)' : 'var(--text-primary)', zIndex: 1000, fontVariantNumeric: 'tabular-nums' }}>
                            {timeLeft}s
                        </div>
                    </>
                )}

                {/* Unified Premium Question Badge */}
                {questionNumber > 0 && (
                    <div style={{ position: 'absolute', top: '2.5rem', right: '2.5rem', background: 'rgba(255,255,255,0.08)', padding: '0.8rem 1.7rem', borderRadius: 'var(--radius-full)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(12px)', boxShadow: 'var(--glass-glow)', display: 'flex', alignItems: 'center', gap: '0.75rem', zIndex: 1000 }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--accent-secondary)', letterSpacing: '2px' }}>QUESTION</span>
                        <span style={{ fontSize: '1.4rem', fontWeight: 900, color: '#fff' }}>{questionNumber}<span style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>/10</span></span>
                    </div>
                )}
            </header>

            <div className="game-arena" ref={arenaRef}>
                {question && (
                    <div className={`question-display ${isTransitioning ? 'slide-out' : 'slide-in'}`}>
                        <p className="question-text" style={{ fontFamily: 'var(--font-main)', fontWeight: '800', color: '#fff' }}>{question.text}</p>
                        {question.code && (
                            <pre className="code-block" style={{ borderRadius: 'var(--radius-md)', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: 'var(--accent-secondary)', fontWeight: '600' }}>{question.code}</pre>
                        )}
                    </div>
                )}

                {/* Answer Orbs — with multiplayer selection markers and reveal highlights */}
                {question?.options.map((opt, i) => {
                    // Find players who selected this orb
                    const selectionsForOrb = playerSelections.filter(s => s.orbId === opt.id);
                    // Reveal styling
                    const isCorrectOrb = revealResult?.correctOrbId === opt.id;
                    const isRevealPhase = currentPhase === 'reveal' && revealResult;
                    let revealBorder = '';
                    if (isRevealPhase) {
                        revealBorder = isCorrectOrb ? '3px solid #10b981' : selectionsForOrb.length > 0 ? '3px solid #ef4444' : '';
                    }

                    return (
                        <div key={opt.id}
                            className={`orb orb-${opt.id.toLowerCase()} ${targetedOrbId === opt.id ? 'targeted' : ''} ${isTransitioning ? 'exit-animation' : 'entry-animation'}`}
                            style={{
                                left: ORB_POSITIONS[i].left, top: ORB_POSITIONS[i].top,
                                animationDelay: isTransitioning ? '0s' : `${i * 0.15}s`,
                                border: revealBorder || undefined,
                                boxShadow: isRevealPhase && isCorrectOrb ? '0 0 30px rgba(16, 185, 129, 0.6)' : isRevealPhase && selectionsForOrb.length > 0 ? '0 0 30px rgba(239, 68, 68, 0.4)' : undefined,
                                transition: 'border 0.3s ease, box-shadow 0.3s ease',
                            }}
                            data-option={opt.id}
                        >
                            {opt.id}: {opt.text}
                            {/* Player selection markers */}
                            {selectionsForOrb.length > 0 && (
                                <div style={{ position: 'absolute', bottom: '-12px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '4px' }}>
                                    {selectionsForOrb.map(sel => (
                                        <div key={sel.controllerId} style={{
                                            width: '12px', height: '12px', borderRadius: '50%',
                                            background: CROSSHAIR_COLORS[sel.colorIndex] || CROSSHAIR_COLORS[0],
                                            border: '2px solid rgba(255,255,255,0.8)',
                                            boxShadow: `0 0 8px ${CROSSHAIR_COLORS[sel.colorIndex] || CROSSHAIR_COLORS[0]}`,
                                        }} />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Projectiles */}
                {projectiles.map((p) => (
                    <div key={p.id} className="projectile" style={{ left: p.targetX - 10, top: p.targetY - 10, transition: 'all 0.3s ease-out' }} />
                ))}

                {/* Per-player Crosshairs — hidden during analysis phase in multiplayer */}
                {(!isMultiplayer || currentPhase === 'selection') && Array.from(crosshairs.entries()).map(([cid, pos]) => {
                    const color = getPlayerColor(cid);
                    return (
                        <div key={cid} style={{ position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)', width: '50px', height: '50px', pointerEvents: 'none', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'left 0.08s linear, top 0.08s linear' }}>
                            <div style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: '50%', border: `2px dashed ${color}55`, boxShadow: `0 0 20px ${color}40, inset 0 0 15px ${color}15` }} />
                            {[0, 90, 180, 270].map((deg) => (
                                <div key={deg} style={{ position: 'absolute', width: '2px', height: '10px', background: color, transform: `rotate(${deg}deg) translateY(-22px)`, boxShadow: `0 0 10px ${color}` }} />
                            ))}
                            <div style={{ width: '6px', height: '6px', background: '#fff', borderRadius: '50%', boxShadow: `0 0 12px #fff, 0 0 24px ${color}` }} />
                        </div>
                    );
                })}


                {/* Hit Effects */}
                {hitEffects.map((e) => (
                    <div key={e.id} className={`hit-effect ${e.correct ? 'hit-correct' : 'hit-wrong'}`} style={{ left: e.x - 75, top: e.y - 75 }} />
                ))}

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
            </div>
        </div >
    );
}
