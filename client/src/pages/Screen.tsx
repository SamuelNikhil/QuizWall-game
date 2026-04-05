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
import { soundManager } from '../utils/sound';
import WinnerScene from '../components/WinnerScene';

type GamePhase = 'connecting' | 'qr-lobby' | 'team-lobby' | 'loading' | 'playing' | 'game-over' | 'exit-scores';

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
    const [_leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

    // Visual effects (client-only)
    const [_projectiles, setProjectiles] = useState<Projectile[]>([]);
    const [_hitEffects, setHitEffects] = useState<{ id: string; x: number; y: number; correct: boolean }[]>([]);
    const [particles, setParticles] = useState<Particle[]>([]);
    const [scorePopups, setScorePopups] = useState<ScorePopup[]>([]);
    const [ripples, setRipples] = useState<Ripple[]>([]);
    const [confetti, setConfetti] = useState<Confetti[]>([]);
    const [crosshairs, setCrosshairs] = useState<Map<string, { x: number; y: number }>>(new Map());
    const [targetedOrbId, setTargetedOrbId] = useState<string | null>(null);

    // Per-player crosshair colors — imported from shared types
    // Store color index from server when controller joins
    const crosshairColorMap = useRef<Map<string, number>>(new Map());
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [controllerCount, setControllerCount] = useState(0);
    const [sessionEnding, setSessionEnding] = useState(false);

    // Loading screen state
    const [countdownActive, setCountdownActive] = useState(false);
    const [countdownValue, setCountdownValue] = useState(3);
    const [showReadyOverlay, setShowReadyOverlay] = useState(false);

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

            client.onLoadingStart((data) => {
                console.log('[Screen] Loading started, players:', data.playerCount);
                setPhaseSync('loading');
                setCountdownActive(false);
            });

            client.onLoadingCountdown((data) => {
                console.log('[Screen] Countdown starting:', data.duration);
                setCountdownActive(true);
                setCountdownValue(data.duration);
                
                // Play countdown beeps
                let count = data.duration;
                soundManager.playCountdownBeep();
                const beepInterval = setInterval(() => {
                    count--;
                    if (count > 0) {
                        soundManager.playCountdownBeep();
                        setCountdownValue(count);
                    } else {
                        clearInterval(beepInterval);
                        setCountdownValue(0);
                    }
                }, 1000);
            });

            client.onGameStarted((data) => {
                console.log('[Screen] Game Started event received:', data, 'current phase:', phaseRef.current);
                setQuestion(data.question);
                setTimeLeft(data.timeLeft);
                setPlayerScores([]);
                setQuestionNumber(1);
                // Always transition to playing when game starts
                setPhaseSync('playing');
                setShowReadyOverlay(true);
                setTimeout(() => setShowReadyOverlay(false), 2000);
            });

            // Phase-based multiplayer events
            client.onPhaseChange((data) => {
                console.log('[Screen] Phase change:', data.phase, 'time:', data.timeLeft, 'current phase:', phaseRef.current);
                setCurrentPhase(data.phase);
                setPhaseTimeLeft(data.timeLeft);
                setQuestionNumber(data.questionNumber);
                setIsMultiplayer(true);
                // Transition from loading to playing when first phase starts
                if (phase === 'loading' && (data.phase === 'analysis' || data.phase === 'selection')) {
                    console.log('[Screen] Transitioning from loading to playing');
                    setPhaseSync('playing');
                    // Show "GET READY" overlay for 2 seconds before showing question
                    setShowReadyOverlay(true);
                    setTimeout(() => setShowReadyOverlay(false), 2000);
                }
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
        return (
            <WinnerScene
                variant="screen"
                scores={gameOverData.playerScores ?? []}
            />
        );

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

    // ---- Loading Phase (AI Questions Loading + Countdown) ----
    if (phase === 'loading') {
        const preConfigNames = ["Wulf", "Talon", "Ryker", "Roux"];
        const preConfigAvatars = ["wulf", "talon", "ryker", "roux"];

        return (
            <div className="screen-container" style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
                background: 'linear-gradient(180deg, #0f0f1a 0%, #1a1a2e 100%)',
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

                <p style={{
                    fontSize: '1.1rem',
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: '3rem',
                }}>
                    {countdownActive ? 'First question incoming' : 'AI is generating your quiz'}
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
    }

    // ---- Playing (Game Arena) ----
    const preConfigNames = ["Wulf", "Talon", "Ryker", "Roux"];
    const preConfigAvatars = ["wulf", "talon", "ryker", "roux"];

    return (
        <div className="screen-container" ref={containerRef}>
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
                    {/* LIVE NOW Badge with animated border */}
                    <div style={{
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.6rem 1.5rem',
                        background: 'rgba(255, 68, 68, 0.1)',
                        borderRadius: '24px',
                        overflow: 'hidden',
                    }}>
                        {/* Animated progress border */}
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: '24px',
                            background: `conic-gradient(from 0deg, #ff4444 ${(100 - ((phaseTimeLeft || timeLeft) / 20) * 100)}%, transparent ${(100 - ((phaseTimeLeft || timeLeft) / 20) * 100)}%)`,
                            mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                            maskComposite: 'exclude',
                            WebkitMaskComposite: 'xor',
                            padding: '2px',
                        }} />
                        <span style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: '#ff4444',
                            boxShadow: '0 0 12px #ff4444',
                            animation: 'pulse 1s ease-in-out infinite',
                        }} />
                        <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 900,
                            color: '#ff4444',
                            letterSpacing: '1.5px',
                        }}>
                            LIVE NOW
                        </span>
                    </div>

                    {/* Round Info - Shows Question Counter */}
                    <div style={{
                        padding: '0.5rem 1.25rem',
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '20px',
                        backdropFilter: 'blur(10px)',
                    }}>
                        <span style={{
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            color: 'rgba(255, 255, 255, 0.6)',
                            letterSpacing: '0.5px',
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
                    const selectionsForOrb = playerSelections.filter(s => s.orbId === opt.id);
                    const isCorrectOrb = revealResult?.correctOrbId === opt.id;
                    const isRevealPhase = currentPhase === 'reveal' && revealResult;
                    
                    const pillGradient = 'linear-gradient(135deg, #04026F 0%, #BB3AD2 100%)';
                    
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
                                border: isRevealPhase
                                    ? isCorrectOrb ? '2px solid #10b981' : '2px solid transparent'
                                    : '1px solid rgba(255,255,255,0.15)',
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
                    // Find player info for this controller
                    const player = lobby?.players.find(p => p.id === controllerId);
                    const colorIndex = player?.colorIndex ?? 0;
                    const color = CROSSHAIR_COLORS[colorIndex];
                    const avatar = preConfigAvatars[colorIndex];
                    const playerName = player ? preConfigNames[colorIndex] : 'Player';
                    
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
                        const playerName = preConfigNames[slotIndex];
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
                                                src={`/avatars/${preConfigAvatars[slotIndex]}.png`}
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
        </div >
    );
}
