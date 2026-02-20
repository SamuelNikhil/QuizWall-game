// ==========================================
// Screen Page — Presentation Layer
// Displays game arena, questions, effects
// ALL logic comes from server events
// ==========================================

import { useEffect, useState, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { GameClient } from '../transport/GameClient';
import { ORB_POSITIONS } from '../shared/types';
import type {
    ClientQuestion,
    HitResultPayload,
    LobbyState,
    GameOverPayload,
    LeaderboardEntry,
} from '../shared/types';
import '../animations.css';

type GamePhase = 'connecting' | 'qr-lobby' | 'team-lobby' | 'playing' | 'game-over' | 'exit-scores';

interface Particle { id: string; x: number; y: number; size: number; color: string; '--tx': string; '--ty': string; }
interface ScorePopup { id: string; x: number; y: number; text: string; type: string; }
interface Ripple { id: string; x: number; y: number; color: string; size: number; }
interface Confetti { id: string; x: number; y: number; color: string; '--dx': string; '--dy': string; '--rot': string; width: number; height: number; }
interface Projectile { id: string; x: number; y: number; targetX: number; targetY: number; }

export default function Screen() {
    // ---- State ----
    const [phase, setPhase] = useState<GamePhase>('connecting');
    const [roomId, setRoomId] = useState<string | null>(null);
    const [joinToken, setJoinToken] = useState<string | null>(null);
    const [lobby, setLobby] = useState<LobbyState | null>(null);
    const [question, setQuestion] = useState<ClientQuestion | null>(null);
    const [timeLeft, setTimeLeft] = useState(30);
    const [teamScore, setTeamScore] = useState(0);
    const [teamName, setTeamName] = useState('');
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

    // Per-player crosshair colors - must match types.ts CROSSHAIR_COLORS
    const CROSSHAIR_COLORS = ['#00f2ff', '#ff6b6b', '#7cff6b'];
    // Store color index from server when controller joins
    const crosshairColorMap = useRef<Map<string, number>>(new Map());
    const getPlayerColor = useCallback((controllerId: string): string => {
        const colorIndex = crosshairColorMap.current.get(controllerId) ?? 0;
        return CROSSHAIR_COLORS[colorIndex] || CROSSHAIR_COLORS[0];
    }, []);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [controllerCount, setControllerCount] = useState(0);
    const [sessionEnding, setSessionEnding] = useState(false);

    const arenaRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const targetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clientRef = useRef<GameClient | null>(null);
    const hadControllersRef = useRef(false);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            createScorePopup(targetX, targetY, '+100', 'correct');
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
                setPhase('qr-lobby');
            });

            client.onLobbyUpdate((data) => {
                setLobby(data);
                setTeamName(data.team.name);
                setControllerCount(data.team.members.length);
                if (data.team.members.length > 0 && phase !== 'playing' && phase !== 'game-over') {
                    setPhase('team-lobby');
                }
            });

            client.onControllerJoined((data) => {
                setControllerCount((prev) => prev + 1);
                // Store the color index from server for this controller
                crosshairColorMap.current.set(data.controllerId, data.colorIndex ?? 0);
            });

            client.onControllerLeft((data) => {
                setControllerCount((prev) => Math.max(0, prev - 1));
                // If all controllers leave during game
                const room = clientRef.current;
                if (room) {
                    // Lobby update will handle the rest
                }
                console.log('Controller left:', data.controllerId);
            });

            client.onGameStarted((data) => {
                console.log('[Screen] Game Started event received:', data);
                setQuestion(data.question);
                setTimeLeft(data.timeLeft);
                setTeamScore(0);
                setPhase('playing');
            });

            client.onQuestion((data) => {
                setQuestion(data);
            });

            client.onTimerSync((data) => {
                setTimeLeft(data.timeLeft);
            });

            client.onScoreUpdate((data) => {
                setTeamScore(data.teamScore);
                setTeamName(data.teamName);
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
                if (data.gyroEnabled) {
                    setCrosshairs(prev => {
                        const next = new Map(prev);
                        next.set(data.controllerId, { x: 50, y: 50 });
                        return next;
                    });
                } else {
                    setCrosshairs(prev => {
                        const next = new Map(prev);
                        next.delete(data.controllerId);
                        return next;
                    });
                }
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
                setPhase('game-over');
            });

            client.onGameRestarted(() => {
                setPhase('team-lobby');
                setQuestion(null);
                setTeamScore(0);
                setTimeLeft(30);
                setGameOverData(null);
            });
        }).catch((err) => {
            console.error('Connection failed:', err);
            // Note: setError is not available in this component
            // The error is logged to console for debugging
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
        // All controllers left after at least one was present
        if (hadControllersRef.current && controllerCount === 0 && !sessionEnding && phase !== 'connecting' && phase !== 'qr-lobby') {
            setSessionEnding(true);
            setTimeout(() => {
                window.location.reload();
            }, 3000);
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
                        {teamName && (
                            <p style={{ color: 'var(--accent-secondary)', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                                {teamName}
                            </p>
                        )}
                        {teamScore > 0 && (
                            <p style={{ fontSize: '4rem', fontWeight: 900, color: '#90e0ef', margin: '0.5rem 0 1.5rem' }}>
                                {teamScore}
                            </p>
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
                    <div className="pulse-ring" />
                    <h2 className="waiting-title">Connecting to Server...</h2>
                </div>
            </div>
        );
    }

    // ---- Game Over ----
    if (phase === 'game-over' && gameOverData) {
        return (
            <div className="screen-container">
                <div
                    className="game-over-screen"
                    style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        height: '100vh', textAlign: 'center',
                        animation: 'bounceIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        position: 'relative', scale: '0.8',
                    }}
                >
                    <h1 style={{ fontSize: '5rem', fontWeight: '900', color: '#ff4444', textShadow: '0 0 40px rgba(255, 0, 0, 0.5)', marginBottom: '0.5rem' }}>
                        TIME'S UP!
                    </h1>
                    <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '2.5rem', borderRadius: '30px', border: '1px solid rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(20px)', minWidth: '350px', marginBottom: '1.5rem' }}>
                        <p style={{ fontSize: '1.2rem', color: 'var(--accent-secondary)', fontWeight: 700, marginBottom: '0.5rem' }}>{gameOverData.teamName}</p>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'rgba(255, 255, 255, 0.8)', fontWeight: '600' }}>Final Score</h2>
                        <p style={{ fontSize: '4.5rem', fontWeight: '900', color: '#90e0ef', margin: 0 }}>{gameOverData.finalScore}</p>
                    </div>

                    {/* Leaderboard */}
                    {gameOverData.leaderboard.length > 0 && (
                        <div style={{ background: 'var(--glass-bg)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', minWidth: '350px', border: '1px solid var(--glass-border)', marginBottom: '1.5rem' }}>
                            <h3 style={{ color: 'var(--accent-primary)', fontWeight: 800, marginBottom: '1rem', fontSize: '1.1rem', letterSpacing: '2px', textTransform: 'uppercase' }}>Leaderboard</h3>
                            {gameOverData.leaderboard.slice(0, 5).map((entry: LeaderboardEntry) => (
                                <div key={entry.rank} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0.75rem', marginBottom: '0.25rem', borderRadius: '8px', background: entry.rank === 1 ? 'rgba(103, 80, 164, 0.2)' : 'transparent' }}>
                                    <span style={{ fontWeight: 700 }}>{entry.rank === 1 ? '👑' : `#${entry.rank}`} {entry.teamName}</span>
                                    <span style={{ color: 'var(--accent-secondary)', fontWeight: 800 }}>{entry.totalScore} pts</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{ marginTop: '1rem', padding: '1rem 3rem', background: '#6750a4', borderRadius: '20px', boxShadow: '0 0 30px rgba(103, 80, 164, 0.6)', border: '2px solid rgba(255, 255, 255, 0.1)', animation: 'pulse 2s ease-in-out infinite' }}>
                        <h2 style={{ color: '#fff', margin: 0, fontSize: '1.8rem', fontWeight: '900', letterSpacing: '1.5px' }}>
                            WAITING FOR LEADER...
                        </h2>
                    </div>

                    {/* Crosshairs visible during Game Over */}
                    {Array.from(crosshairs.entries()).map(([cid, pos]) => {
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

                    {/* Particles during game over */}
                    {particles.map((p) => (
                        <div key={p.id} className="particle particle-explode" style={{ left: p.x, top: p.y, width: p.size, height: p.size, backgroundColor: p.color, '--tx': p['--tx'], '--ty': p['--ty'] } as React.CSSProperties} />
                    ))}
                </div>
            </div>
        );
    }

    // ---- QR Code Lobby (no controllers yet) ----
    if (phase === 'qr-lobby' || (phase === 'team-lobby' && controllerCount === 0)) {
        return (
            <div className="qr-fullscreen">
                <h1 style={{ fontSize: '3rem', marginBottom: '1rem', color: '#fff', fontWeight: '900', textShadow: '0 0 50px rgba(103, 80, 164, 0.6)', textAlign: 'center', letterSpacing: '-3px', lineHeight: '1.1', fontFamily: 'var(--font-main)' }}>
                    Quiz Wall
                </h1>

                <div className="qr-content-wrapper">
                    <div className="qr-left-column">
                        <div className="qr-box-large">
                            <QRCodeSVG value={controllerUrl} size={240} level="H" fgColor="#1C1B1F" />
                        </div>
                        <p style={{ marginTop: '2rem', fontSize: '1.25rem', fontWeight: '600', opacity: 0.8 }}>Scan to Play 🎯</p>
                    </div>

                    <div className="qr-leaderboard">
                        <h3 style={{ fontFamily: 'var(--font-main)', fontWeight: '800' }}>Leaderboard</h3>
                        {leaderboard.length > 0 ? (
                            <div style={{ padding: '0.5rem 0' }}>
                                {leaderboard.slice(0, 10).map((entry) => (
                                    <div key={entry.rank} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '0.6rem 1rem', marginBottom: '0.35rem', borderRadius: '10px',
                                        background: entry.rank <= 3 ? 'rgba(103, 80, 164, 0.15)' : 'rgba(255,255,255,0.03)',
                                        border: entry.rank === 1 ? '1px solid rgba(103, 80, 164, 0.4)' : '1px solid transparent',
                                    }}>
                                        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff' }}>
                                            {entry.rank === 1 ? '👑' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `#${entry.rank}`}{' '}
                                            {entry.teamName}
                                        </span>
                                        <span style={{ color: 'var(--accent-secondary)', fontWeight: 800, fontSize: '0.95rem' }}>
                                            {entry.totalScore} pts
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.6, fontStyle: 'italic', fontSize: '1rem' }}>No scores yet — be the first!</div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ---- Team Lobby (controllers joined, waiting for start) ----
    if (phase === 'team-lobby') {
        return (
            <div className="qr-fullscreen">
                <h1 style={{ fontSize: '3rem', marginBottom: '0.5rem', color: '#fff', fontWeight: '900', textShadow: '0 0 50px rgba(103, 80, 164, 0.6)', textAlign: 'center', fontFamily: 'var(--font-main)' }}>
                    Quiz Wall
                </h1>
                {teamName && (
                    <h2 style={{ fontSize: '1.5rem', color: 'var(--accent-secondary)', fontWeight: 800, marginBottom: '1rem' }}>
                        Team: {teamName}
                    </h2>
                )}

                <div className="qr-content-wrapper">
                    <div className="qr-left-column">
                        <div className="qr-box-large">
                            <QRCodeSVG value={controllerUrl} size={240} level="H" fgColor="#1C1B1F" />
                        </div>
                        <p style={{ marginTop: '1rem', fontSize: '1rem', fontWeight: '600', opacity: 0.8 }}>
                            {controllerCount}/3 Players Joined
                        </p>
                    </div>

                    <div className="qr-leaderboard">
                        <h3 style={{ fontFamily: 'var(--font-main)', fontWeight: '800' }}>Team Roster</h3>
                        {lobby?.team.members.map((m, i) => (
                            <div key={m.id} className="qr-leaderboard-item" style={{ borderRadius: 'var(--radius-md)', border: m.role === 'leader' ? '2px solid var(--accent-primary)' : '1px solid var(--glass-border)', background: m.role === 'leader' ? 'rgba(103, 80, 164, 0.2)' : 'var(--glass-bg)' }}>
                                <span style={{ fontSize: '0.9rem' }}>{m.role === 'leader' ? '👑' : `#${i + 1}`} Player</span>
                                <span style={{ color: m.isReady ? 'var(--accent-success)' : 'var(--text-secondary)', fontWeight: '800', fontSize: '1rem' }}>
                                    {m.isReady ? '✓ Ready' : '⏳ Waiting'}
                                </span>
                            </div>
                        ))}
                        <div style={{ textAlign: 'center', marginTop: '1rem', padding: '1rem', background: lobby?.canStart ? 'rgba(103, 80, 164, 0.15)' : 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--glass-border)' }}>
                            <p style={{ fontWeight: 800, color: lobby?.canStart ? 'var(--accent-success)' : 'var(--text-secondary)' }}>
                                {lobby?.canStart ? '🚀 Ready to Start!' : '⏳ Waiting for players...'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ---- Playing (Game Arena) ---- (identical UI to original)
    return (
        <div className="screen-container" ref={containerRef}>
            <header className="screen-header" style={{ justifyContent: 'flex-end', padding: '2rem' }}>
                <div className="player-count-badge">
                    <span style={{ fontSize: '1.2rem', filter: 'drop-shadow(0 0 10px rgba(103, 80, 164, 0.5))' }}>👥</span>
                    <span style={{ fontWeight: '900', color: 'var(--text-primary)' }}>{controllerCount}</span>
                    <div style={{ display: 'flex', gap: '20px', borderLeft: '2px solid var(--glass-border)', paddingLeft: '20px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ color: 'var(--accent-secondary)', fontWeight: 700, fontSize: '0.9rem' }}>{teamName}</span>
                            <span style={{ color: 'var(--accent-secondary)', fontWeight: '800', fontSize: '1.1rem' }}>
                                Score: {teamScore}
                            </span>
                        </span>
                    </div>
                </div>
                {/* Timer Bar */}
                <div style={{ position: 'absolute', top: '0', left: '0', width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', zIndex: 1000 }}>
                    <div style={{ width: `${(timeLeft / 30) * 100}%`, height: '100%', background: timeLeft <= 10 ? 'var(--accent-error)' : 'var(--accent-primary)', transition: 'width 1s linear, background 0.3s ease', boxShadow: `0 0 20px ${timeLeft <= 10 ? 'var(--accent-error)' : 'var(--accent-primary)'}` }} />
                </div>
                <div style={{ position: 'absolute', top: '3rem', left: '2rem', fontSize: '1.8rem', fontWeight: '900', color: timeLeft <= 10 ? 'var(--accent-error)' : 'var(--text-primary)', zIndex: 1000 }}>
                    {timeLeft}s
                </div>
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

                {/* Answer Orbs */}
                {question?.options.map((opt, i) => (
                    <div key={opt.id}
                        className={`orb orb-${opt.id.toLowerCase()} ${targetedOrbId === opt.id ? 'targeted' : ''} ${isTransitioning ? 'exit-animation' : 'entry-animation'}`}
                        style={{ left: ORB_POSITIONS[i].left, top: ORB_POSITIONS[i].top, animationDelay: isTransitioning ? '0s' : `${i * 0.15}s` }}
                        data-option={opt.id}
                    >
                        {opt.id}: {opt.text}
                    </div>
                ))}

                {/* Projectiles */}
                {projectiles.map((p) => (
                    <div key={p.id} className="projectile" style={{ left: p.targetX - 10, top: p.targetY - 10, transition: 'all 0.3s ease-out' }} />
                ))}

                {/* Per-player Crosshairs */}
                {Array.from(crosshairs.entries()).map(([cid, pos]) => {
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
        </div>
    );
}
