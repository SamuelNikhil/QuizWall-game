// ==========================================
// Controller Page — Presentation Layer
// Slingshot / Gyro input + Lobby integration
// ==========================================

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { GameClient } from '../transport/GameClient';
import Lobby from './Lobby';
import type { LobbyState, PlayerRole, ScoreUpdate, QuestionPhase, PlayerSelectionPayload, RevealResultPayload, PlayerScoreEntry } from '../shared/types';
import { CROSSHAIR_COLORS } from '../shared/types';
import slingCenterImg from '../assets/sling-center.svg';
import '../index.css';
import '../animations.css';
import { soundManager } from '../utils/sound';


type ControllerPhase = 'connecting' | 'lobby' | 'loading' | 'playing' | 'game-over';

export default function Controller() {
    const { roomId, token } = useParams<{ roomId: string; token: string }>();

    // ---- Connection ----
    const [phase, setPhase] = useState<ControllerPhase>('connecting');
    const [role, setRole] = useState<PlayerRole>('member');
    const [colorIndex, setColorIndex] = useState<number>(0);
    const [lobby, setLobby] = useState<LobbyState | null>(null);
    const [persistentName, setPersistentName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Persistent clientId to survive reloads/React double-mounts (localStorage for cross-session persistence)
    const clientIdRef = useRef<string>(
        localStorage.getItem('slingshot_client_id') ||
        Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );

    useEffect(() => {
        if (!localStorage.getItem('slingshot_client_id')) {
            localStorage.setItem('slingshot_client_id', clientIdRef.current);
        }
    }, []);

    // ---- Game state (from server) ----
    const [timeLeft, setTimeLeft] = useState(20);
    const [gameOverReason, setGameOverReason] = useState<'time' | 'completed' | 'all_wrong'>('time');
    const [lastHit, setLastHit] = useState<{ correct: boolean } | null>(null);
    const [playerScores, setPlayerScores] = useState<PlayerScoreEntry[]>([]);
    const [scorePopups, setScorePopups] = useState<{ id: string; score: number; bonus: number; colorIndex: number }[]>([]);

    // Phase-based multiplayer state
    const [currentPhase, setCurrentPhase] = useState<QuestionPhase | null>(null);
    const [phaseTimeLeft, setPhaseTimeLeft] = useState(0);
    const [hasSelectedThisRound, setHasSelectedThisRound] = useState(false);
    const [selectedOrbId, setSelectedOrbId] = useState<string | null>(null);
    const [isMultiplayer, setIsMultiplayer] = useState(false);
    const [isSpectating, setIsSpectating] = useState(false);
    const currentPhaseRef = useRef<QuestionPhase | null>(null);
    const hasSelectedRef = useRef(false);

    // ---- Slingshot state ----
    const [isDragging, setIsDragging] = useState(false);
    const [pullBack, setPullBack] = useState(0);
    const [power, setPower] = useState(0);
    const [targetXPercent, setTargetXPercent] = useState(50);
    const [targetYPercent, setTargetYPercent] = useState(50);
    const [aimAngle, setAimAngle] = useState(0);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });



    // ---- Dragging ref for real-time values ----
    const isDraggingRef = useRef(false);

    // Sync refs with state
    useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);

    const clientRef = useRef<GameClient | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);

    // Throttle crosshair updates to ~30fps
    const lastCrosshairSend = useRef<number>(0);
    const throttledSendCrosshair = useCallback((x: number, y: number) => {
        const now = Date.now();
        if (now - lastCrosshairSend.current >= 33) { // ~30fps
            lastCrosshairSend.current = now;
            clientRef.current?.sendCrosshair(x, y);
        }
    }, []);

    // ---- Connect and wire events ----
    useEffect(() => {
        if (!roomId || !token) return;

        const client = new GameClient();
        clientRef.current = client;

        client.connect().then(() => {
            console.log(`[Room] Joining room ${roomId} with clientId ${clientIdRef.current}`);
            client.joinRoom(roomId, token, clientIdRef.current);

            client.onJoinedRoom((data) => {
                console.log('[Room] Joined room:', data);
                if (!data.success) {
                    setError(data.error || 'Failed to join room');
                    return;
                }
                console.log(`[Room] Role assigned: ${data.role}, Color: ${data.colorIndex}, Name: ${data.playerName || 'new player'}`);
                setRole(data.role!);
                setColorIndex(data.colorIndex ?? 0);
                if (data.playerName) {
                    setPersistentName(data.playerName);
                }
                setPhase('lobby');
            });

            client.onLobbyUpdate((data) => {
                setLobby(data);
                if (clientIdRef.current) {
                    const me = data.players.find(p => p.id === clientIdRef.current);
                    if (me) {
                        if (me.colorIndex !== undefined) setColorIndex(me.colorIndex);
                        if (me.isSpectating !== undefined) setIsSpectating(me.isSpectating);
                    }
                }
            });

            client.onRolePromoted((data) => {
                console.log('[Room] Role promoted to:', data.role);
                setRole(data.role);
            });

            // Tutorial events - kept for compatibility but no longer used
            // client.onTutorialStart and onTutorialEnd removed

            client.onGameStarted(() => {
                // Game started event - transition to loading screen
                console.log('[Controller] Game started, showing loading screen');
                setPhase('loading');
                // Player scores are tracked via SCORE_UPDATE events
            });

            client.onTimerSync((data) => {
                setTimeLeft(data.timeLeft);
            });

            client.onScoreUpdate((data: ScoreUpdate) => {
                setPlayerScores(data.playerScores || []);
            });

            client.onHitResult((data) => {
                setLastHit({ correct: data.correct });

                // Play sound feedback
                soundManager.playHit(data.correct);

                // Haptic feedback (safe for all browsers including iOS)
                soundManager.vibrate(data.correct ? [50, 50, 50] : [200]);
                setTimeout(() => setLastHit(null), 800);

                // Show score popup for singleplayer (similar to multiplayer reveal)
                if (data.correct && data.points > 0) {
                    const popupId = `score-${Date.now()}-${data.controllerId}`;
                    setScorePopups(prev => [...prev, {
                        id: popupId,
                        score: data.points,
                        bonus: data.bonus ?? 0,
                        colorIndex: colorIndex, // Use player's color
                    }]);
                    // Remove popup after animation
                    setTimeout(() => {
                        setScorePopups(prev => prev.filter(p => p.id !== popupId));
                    }, 2000);
                }
            });

            client.onGameOver((data) => {
                setGameOverReason(data.reason || 'time');
                setPlayerScores(data.playerScores || []);
                setPhase('game-over');
            });

            // Phase-based multiplayer events
            client.onPhaseChange((data) => {
                setCurrentPhase(data.phase);
                currentPhaseRef.current = data.phase;
                setPhaseTimeLeft(data.timeLeft);
                setIsMultiplayer(true);
                // Transition from loading to playing when phase starts
                if (phase === 'loading' && (data.phase === 'selection' || data.phase === 'analysis')) {
                    setPhase('playing');
                }
                // Reset selection lock when entering analysis phase (new question)
                if (data.phase === 'analysis' && data.timeLeft === 1) {
                    setHasSelectedThisRound(false);
                    hasSelectedRef.current = false;
                    setSelectedOrbId(null);
                }
            });

            client.onPlayerSelection((_data: PlayerSelectionPayload) => {
                // Lock this controller's sling ONLY when the server confirms OUR selection
                if (_data.controllerId === clientIdRef.current) {
                    console.log('[Controller] My selection confirmed by server, locking sling');
                    setHasSelectedThisRound(true);
                    hasSelectedRef.current = true;
                    setSelectedOrbId(_data.orbId);
                    // Haptic feedback when selection is confirmed
                    soundManager.vibrate([30, 20, 30]);
                } else {
                    console.log('[Controller] Other player selection:', _data.controllerId.substring(0, 8));
                }
            });

            client.onRevealResult((data: RevealResultPayload) => {
                // Find this specific player's result from the summary
                const myResult = data.playerScores?.find(ps => ps.controllerId === clientIdRef.current);
                const isPersonallyCorrect = myResult ? myResult.correct : false;

                console.log('[Controller] Reveal result:', isPersonallyCorrect ? 'correct!' : 'wrong');

                // Play individual sound feedback
                soundManager.playHit(isPersonallyCorrect);

                // Haptic feedback based on personal result (safe for all browsers including iOS)
                soundManager.vibrate(isPersonallyCorrect ? [50, 50, 50] : [200]);

                // Show visual individual hit feedback (green for correct, red for wrong)
                setLastHit({ correct: isPersonallyCorrect });
                setTimeout(() => setLastHit(null), 1500);

                // Show score popup ONLY for this player (already implemented, but confirmed it uses clientIdRef)
                if (data.playerScores && myResult && myResult.correct && myResult.score > 0) {
                    const popupId = `score-${Date.now()}-${myResult.controllerId}`;
                    setScorePopups(prev => [...prev, {
                        id: popupId,
                        score: myResult.score,
                        bonus: myResult.bonus,
                        colorIndex: myResult.colorIndex
                    }]);
                    // Remove popup after animation
                    setTimeout(() => {
                        setScorePopups(prev => prev.filter(p => p.id !== popupId));
                    }, 2000);
                }
            });

            client.onGameRestarted(() => {
                setPhase('lobby');
                setIsSpectating(false);
                setPlayerScores([]);
                setTimeLeft(20);
                setCurrentPhase(null);
                currentPhaseRef.current = null;
                setHasSelectedThisRound(false);
                hasSelectedRef.current = false;
                setIsMultiplayer(false);
            });

            // Tutorial status updates from server
// Tutorial status updates - removed
        }).catch((err) => {
            console.error('Connection failed:', err);
            setError('Connection failed');
        });

        return () => { client.close(); };
    }, [roomId, token]);

    // ---- Gyroscope handler REMOVED ----

    // ---- Screen Wake Lock — prevent phone from sleeping during gameplay ----
    useEffect(() => {
        if (phase !== 'playing' && phase !== 'loading') {
            // Release wake lock when not in active gameplay
            if (wakeLockRef.current) {
                wakeLockRef.current.release().catch(() => { });
                wakeLockRef.current = null;
            }
            return;
        }

        const acquireWakeLock = async () => {
            try {
                if ('wakeLock' in navigator) {
                    wakeLockRef.current = await navigator.wakeLock.request('screen');
                    console.log('[WakeLock] Screen wake lock acquired');
                    wakeLockRef.current.addEventListener('release', () => {
                        console.log('[WakeLock] Screen wake lock released');
                    });
                }
            } catch (err) {
                console.warn('[WakeLock] Failed to acquire:', err);
            }
        };

        acquireWakeLock();

        // Re-acquire wake lock if the page becomes visible again (e.g., tab switch)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && (phase === 'playing' || phase === 'loading')) {
                acquireWakeLock();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (wakeLockRef.current) {
                wakeLockRef.current.release().catch(() => { });
                wakeLockRef.current = null;
            }
        };
    }, [phase]);

    // Gyro orientation handler REMOVED

    // ---- Gyro permission request REMOVED ----

    // ---- Slingshot touch handlers ----

    const handleStart = useCallback(() => {
        if (phase !== 'playing' && phase !== 'loading') return;
        // In multiplayer, only allow slingshot during selection phase and if not already selected
        if (phase === 'playing' && isMultiplayer && (currentPhaseRef.current !== 'selection' || hasSelectedRef.current)) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        setIsDragging(true);
        // Fixed center start position
        setStartPos({ x: rect.width / 2, y: rect.height / 2 });
        setPullBack(0);
        setPower(0);

        // iOS Audio Unlock - must happen on first user gesture
        soundManager.unlock();

        // Light haptic feedback when starting to pull the sling
        soundManager.vibrate(15);

        if (phase === 'playing') {
            clientRef.current?.sendStartAiming();
        }
    }, [phase, isMultiplayer]);

    const handleMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        if (!isDragging || (phase !== 'playing' && phase !== 'loading')) return;

        const touch = 'touches' in e ? e.touches[0] : e;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        const dx = startPos.x - x;
        const dy = startPos.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxPull = 100; // Match boundaryRadius
        const clampedDist = Math.min(dist, maxPull);
        const angle = Math.atan2(dy, dx);

        setPullBack(clampedDist);
        setPower(Math.min(100, (clampedDist / maxPull) * 100));
        setAimAngle(angle);

        // Map pull direction to screen target (x-axis inverted)
        const tX = Math.max(0, Math.min(100, 50 - (dx / maxPull) * 50));
        const tY = Math.max(0, Math.min(100, 50 - (dy / maxPull) * 50));
        setTargetXPercent(tX);
        setTargetYPercent(tY);
        if (phase === 'playing') {
            clientRef.current?.sendCrosshair(tX, tY);
        }
    }, [isDragging, startPos, phase]);

    const handleEnd = useCallback(() => {
        if (!isDragging) return;

        // During loading, don't shoot, just release
        if (phase === 'loading') {
            setIsDragging(false);
            setPullBack(0);
            setPower(0);
            return;
        }

        // Cancel crosshair on screen when not dragging
        clientRef.current?.sendCancelAiming();

        if (power > 10 && phase === 'playing') {
            clientRef.current?.shoot(targetXPercent, targetYPercent, power / 100);
        } else {
            clientRef.current?.sendCancelAiming();
        }

        setIsDragging(false);
        setPullBack(0);
        setPower(0);
    }, [isDragging, power, targetXPercent, targetYPercent, phase, isMultiplayer]);

    // ==========================================
    // RENDER — preserving existing controller UX
    // ==========================================

    // ---- Error ----
    if (error) {
        return (
            <div className="controller-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <h2 style={{ color: 'var(--accent-error)', fontSize: '1.5rem', fontWeight: 900 }}>❌ {error}</h2>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>Try scanning the QR code again.</p>
                </div>
            </div>
        );
    }

    // ---- Connecting ----
    if (phase === 'connecting') {
        return (
            <div className="controller-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <div className="pulse-ring" />
                <h2 className="waiting-title" style={{ marginTop: '1rem' }}>Connecting...</h2>
            </div>
        );
    }

    // ---- Lobby ----
    if (phase === 'lobby') {
        return (
            <Lobby
                role={role}
                colorIndex={colorIndex}
                lobby={lobby}
                persistentName={persistentName || undefined}
                onSetPlayerName={(name) => clientRef.current?.setPlayerName(name)}
                onReady={() => clientRef.current?.setReady()}
                onStartGame={() => clientRef.current?.startGame()}
                onLeave={() => {
                    clientRef.current?.close();
                    window.location.href = '/';
                }}
                isSpectating={isSpectating}
            />
        );
    }

    // ---- Slingshot Layout Calculations (shared by loading + playing phases) ----
    const width = containerRef.current?.offsetWidth || 400;
    const height = containerRef.current?.offsetHeight || 800;
    const slingshotCenterX = width / 2;
    const slingshotCenterY = height / 2;
    const boundaryRadius = 100;
    const pullEndX = isDragging ? slingshotCenterX - Math.cos(aimAngle) * pullBack : slingshotCenterX;
    const pullEndY = isDragging ? slingshotCenterY - Math.sin(aimAngle) * pullBack : slingshotCenterY;

    // ---- Loading Questions Phase ----
    if (phase === 'loading') {
        const myColor = CROSSHAIR_COLORS[colorIndex] || '#6750A4';

        return (
            <div className="controller-container" style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                textAlign: 'center',
                padding: '2rem',
                background: 'linear-gradient(180deg, #1C1B1F 0%, #2D2C31 100%)',
            }}>
                <div style={{
                    background: 'var(--glass-bg)',
                    padding: '2.5rem 2rem',
                    borderRadius: 'var(--radius-lg)',
                    border: `1px solid ${myColor}40`,
                    backdropFilter: 'blur(20px)',
                    maxWidth: '320px',
                    width: '100%',
                    boxShadow: `0 10px 40px ${myColor}15`,
                    animation: 'bounceIn 0.5s ease-out',
                }}>
                    <div style={{
                        width: '50px',
                        height: '50px',
                        margin: '0 auto 1.5rem',
                        border: '4px solid rgba(255,255,255,0.05)',
                        borderTop: `4px solid ${myColor}`,
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                    }} />
                    <h2 style={{
                        fontSize: '1.5rem',
                        fontWeight: 900,
                        color: '#fff',
                        margin: '0 0 0.5rem',
                    }}>
                        Loading Questions...
                    </h2>
                    <p style={{
                        color: 'var(--text-secondary)',
                        fontSize: '0.9rem',
                        margin: 0,
                        opacity: 0.8,
                    }}>
                        AI is generating your quiz
                    </p>
                    <div style={{
                        marginTop: '1.5rem',
                        fontSize: '0.8rem',
                        color: myColor,
                        fontWeight: 800,
                        letterSpacing: '1px',
                    }}>
                        GET READY!
                    </div>
                </div>
            </div>
        );
    }

    // ---- Game Over ----
    if (phase === 'game-over') {
        const isCompleted = gameOverReason === 'completed';
        return (
            <div className="controller-container" style={{ justifyContent: 'center', alignItems: 'center', padding: '2rem', position: 'relative' }}>
                {/* Header with Close Button */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '1.5rem', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', zIndex: 10 }}>
                    <button
                        onClick={() => {
                            clientRef.current?.close();
                            window.location.href = '/';
                        }}
                        style={{
                            width: '42px', height: '42px', borderRadius: '50%',
                            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                            color: '#fff', fontSize: '1.2rem', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            backdropFilter: 'blur(10px)', transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    >
                        ✕
                    </button>
                </div>

                <div style={{ textAlign: 'center', animation: 'bounceIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                    <h1 style={{
                        fontSize: isCompleted ? '2rem' : '2.5rem',
                        fontWeight: 900,
                        color: isCompleted ? '#10b981' : '#ff4444',
                        lineHeight: 1.2,
                    }}>
                        {isCompleted ? 'ALL QUESTIONS COMPLETED!' : "TIME'S UP!"}
                    </h1>

                    {isCompleted && (
                        <p style={{ fontSize: '1rem', color: '#90e0ef', margin: '0.5rem 0 1rem' }}>
                            Great job! You answered all 10 questions.
                        </p>
                    )}

                    <div style={{ background: 'var(--glass-bg)', padding: '2rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--glass-border)', margin: '1.5rem 0' }}>
                        <p style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '0.5rem' }}>Your Score</p>
                        <p style={{ fontSize: '3.5rem', fontWeight: 900, color: '#90e0ef' }}>{playerScores.find(p => p.controllerId === clientIdRef.current)?.score ?? 0}</p>
                    </div>

                    {/* Individual Player Scoreboard */}
                    {playerScores.length > 0 && (
                        <div style={{
                            background: 'var(--glass-bg)', padding: '1.25rem', borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--glass-border)', marginBottom: '1.5rem', width: '100%', maxWidth: '320px',
                        }}>
                            <h3 style={{ color: 'var(--accent-primary)', fontWeight: 800, marginBottom: '0.75rem', fontSize: '0.9rem', letterSpacing: '2px', textTransform: 'uppercase' }}>
                                Scoreboard
                            </h3>
                            {playerScores.map((ps, idx) => (
                                <div key={ps.controllerId} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '0.5rem 0.75rem', marginBottom: '0.25rem', borderRadius: '8px',
                                    background: idx === 0 ? 'rgba(103, 80, 164, 0.2)' : 'transparent',
                                }}>
                                    <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', fontSize: '0.9rem' }}>
                                        <span style={{
                                            width: '8px', height: '8px', borderRadius: '50%',
                                            background: CROSSHAIR_COLORS[ps.colorIndex] || CROSSHAIR_COLORS[0],
                                            boxShadow: `0 0 4px ${CROSSHAIR_COLORS[ps.colorIndex] || CROSSHAIR_COLORS[0]}`,
                                        }} />
                                        {idx === 0 ? '🏆' : `#${idx + 1}`} {ps.name}
                                    </span>
                                    <span style={{ color: 'var(--accent-secondary)', fontWeight: 800, fontSize: '0.9rem' }}>
                                        {ps.score} pts
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Leader Actions - Only Play Again button */}
                    {role === 'leader' && (
                        <div style={{ display: 'flex', gap: '1rem', flexDirection: 'column', alignItems: 'center' }}>
                            <button
                                onClick={() => clientRef.current?.restartGame()}
                                style={{
                                    padding: '1rem 3rem',
                                    fontSize: '1.2rem',
                                    fontWeight: 800,
                                    background: 'var(--accent-primary)',
                                    border: 'none',
                                    borderRadius: 'var(--radius-md)',
                                    color: 'white',
                                    cursor: 'pointer',
                                    boxShadow: '0 8px 25px rgba(103, 80, 164, 0.5)',
                                    transition: 'all 0.2s ease',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'scale(1.05)';
                                    e.currentTarget.style.boxShadow = '0 12px 30px rgba(103, 80, 164, 0.6)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'scale(1)';
                                    e.currentTarget.style.boxShadow = '0 8px 25px rgba(103, 80, 164, 0.5)';
                                }}
                            >
                                🔄 Play Again
                            </button>

                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
                                Use ✕ in top-right to close
                            </p>
                        </div>
                    )}

                    {role !== 'leader' && (
                        <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Waiting for leader to restart...</p>
                    )}
                </div>
            </div>
        );
    }

    // ---- Playing (Slingshot) ----

    return (
        <div
            ref={containerRef}
            className="controller-container"
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
            onMouseDown={handleStart}
            onMouseMove={handleMove}
            onMouseUp={handleEnd}
            style={{ position: 'relative', overflow: 'hidden', touchAction: 'none' }}
        >
            {/* Hit feedback overlay */}
            {lastHit && (
                <div
                    style={{
                        position: 'absolute', inset: 0, zIndex: 2000, pointerEvents: 'none',
                        background: lastHit.correct
                            ? 'radial-gradient(circle at center, rgba(16,185,129,0.4), transparent 80%)'
                            : 'radial-gradient(circle at center, rgba(239,68,68,0.4), transparent 80%)',
                        animation: 'bounceIn 0.5s ease-out',
                    }}
                />
            )}

            {/* Score Popups - show bonus points with player colors */}
            {scorePopups.map((popup) => (
                <div
                    key={popup.id}
                    style={{
                        position: 'absolute',
                        top: '30%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 3000,
                        pointerEvents: 'none',
                        animation: 'scorePopup 2s ease-out forwards',
                    }}
                >
                    <div style={{
                        background: `linear-gradient(135deg, ${CROSSHAIR_COLORS[popup.colorIndex]}22, ${CROSSHAIR_COLORS[popup.colorIndex]}44)`,
                        border: `2px solid ${CROSSHAIR_COLORS[popup.colorIndex]}`,
                        borderRadius: '12px',
                        padding: '0.75rem 1.5rem',
                        boxShadow: `0 0 20px ${CROSSHAIR_COLORS[popup.colorIndex]}66`,
                        backdropFilter: 'blur(10px)',
                    }}>
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            color: '#fff',
                        }}>
                            <span style={{
                                fontSize: '1.8rem',
                                fontWeight: 900,
                                textShadow: `0 0 10px ${CROSSHAIR_COLORS[popup.colorIndex]}`,
                            }}>
                                +{popup.score}
                            </span>
                            {popup.bonus > 0 && (
                                <span style={{
                                    fontSize: '0.85rem',
                                    fontWeight: 700,
                                    color: CROSSHAIR_COLORS[popup.colorIndex],
                                    marginTop: '-0.25rem',
                                }}>
                                    (+{popup.bonus} bonus!)
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            ))}

            {/* Header — phase-aware for multiplayer, classic for singleplayer */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '0.6rem 1rem', borderRadius: 'var(--radius-md)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <span style={{ fontSize: '1.4rem' }}>{role === 'leader' ? '👑' : '🎮'}</span>
                    <span style={{ fontWeight: 800, color: '#fff', fontSize: '1rem', letterSpacing: '0.5px' }}>Score: {playerScores.find(p => p.controllerId === clientIdRef.current)?.score ?? 0}</span>
                    {/* Crosshair Color Indicator */}
                    <div
                        style={{
                            width: '0.75rem',
                            height: '0.75rem',
                            borderRadius: '50%',
                            background: CROSSHAIR_COLORS[colorIndex],
                            boxShadow: `0 0 0.5rem ${CROSSHAIR_COLORS[colorIndex]}`,
                            marginLeft: '0.25rem'
                        }}
                        title="Your crosshair color"
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {/* Phase indicator or classic timer */}
                    {isMultiplayer && currentPhase ? (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            background: currentPhase === 'analysis' ? 'rgba(103,80,164,0.2)' : currentPhase === 'selection' ? 'rgba(255,149,0,0.2)' : 'rgba(16,185,129,0.2)',
                            padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)',
                            border: `1px solid ${currentPhase === 'analysis' ? '#6750A4' : currentPhase === 'selection' ? '#ff9500' : '#10b981'}40`,
                            animation: currentPhase === 'selection' ? 'pulse 0.8s ease-in-out infinite' : 'none',
                        }}>
                            <span style={{ fontWeight: 800, fontSize: '0.85rem', letterSpacing: '1px', color: currentPhase === 'analysis' ? '#b8a9d4' : currentPhase === 'selection' ? '#ffb347' : '#6ee7b7' }}>
                                {currentPhase === 'analysis' ? '🔍' : currentPhase === 'selection' ? '🎯' : '✨'}
                                {' '}{currentPhase.toUpperCase()}
                            </span>
                            <span style={{ fontWeight: 900, fontSize: '1.1rem', color: phaseTimeLeft <= 3 ? '#ff6b6b' : '#fff', fontVariantNumeric: 'tabular-nums' }}>
                                {phaseTimeLeft}s
                            </span>
                        </div>
                    ) : (
                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.6rem 1rem', borderRadius: 'var(--radius-md)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <span style={{ fontWeight: 800, color: timeLeft <= 10 ? '#ff6b6b' : '#fff', fontSize: '1.1rem', fontVariantNumeric: 'tabular-nums' }}>
                                {timeLeft}s
                            </span>
                        </div>
                    )}
                    <button
                        onClick={() => {
                            if (phase === 'playing') {
                                // If playing, just leave to lobby (save score, don't disconnect)
                                clientRef.current?.sendLeaveGame();
                                setIsSpectating(true);
                                setPhase('lobby');
                            } else {
                                // Default behavior for other screens (disconnect)
                                clientRef.current?.close();
                                window.location.href = '/';
                            }
                        }}
                        style={{
                            width: '42px', height: '42px', borderRadius: '50%',
                            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                            color: '#fff', fontSize: '1.2rem', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            backdropFilter: 'blur(10px)', transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Multiplayer selection lock indicator — below slingshot */}
            {isMultiplayer && hasSelectedThisRound && currentPhase === 'selection' && (
                <div style={{
                    position: 'absolute', bottom: '5rem', left: '50%', transform: 'translateX(-50%)',
                    background: 'rgba(16,185,129,0.15)', padding: '0.8rem 2rem', borderRadius: 'var(--radius-lg)',
                    border: '2px solid rgba(16,185,129,0.4)', zIndex: 100,
                    pointerEvents: 'none',
                    animation: 'bounceIn 0.5s ease-out',
                }}>
                    <p style={{ fontSize: '1.1rem', fontWeight: 900, color: '#6ee7b7', textAlign: 'center' }}>✅ Answer Locked — Option {selectedOrbId || '?'}</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '0.2rem' }}>Waiting for reveal...</p>
                </div>
            )}

            {/* Multiplayer analysis phase indicator — below slingshot */}
            {isMultiplayer && currentPhase === 'analysis' && phase === 'playing' && (
                <div style={{
                    position: 'absolute', bottom: '5rem', left: '50%', transform: 'translateX(-50%)',
                    textAlign: 'center', pointerEvents: 'none', zIndex: 100,
                    opacity: 0.7,
                }}>
                    <p style={{ fontSize: '1.4rem', fontWeight: 900, color: '#b8a9d4' }}>🔍 Read the Question</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>Slingshot unlocks in {phaseTimeLeft}s</p>
                </div>
            )}

            {/* Gyro Setup removed from here, now in Lobby */}

            {/* Power indicator */}
            {isDragging && (
                <div style={{
                    position: 'absolute', bottom: '2rem', left: '50%', transform: 'translateX(-50%)',
                    width: '70%', height: '12px', background: 'rgba(255,255,255,0.08)', borderRadius: '6px', zIndex: 10,
                    border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden', padding: '2px'
                }}>
                    <div style={{
                        width: `${power}%`, height: '100%', borderRadius: '4px',
                        background: `linear-gradient(90deg, #7cff6b 0%, #00f2ff ${power > 50 ? '50%' : '100%'}, #ff4444 100%)`,
                        boxShadow: `0 0 15px ${power > 70 ? '#ff4444aa' : power > 30 ? '#00f2ffaa' : '#7cff6baa'}`,
                        transition: 'width 0.05s linear',
                    }} />
                </div>
            )}

            {/* Slingshot visual */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }}>
                {/* Dotted Circle Boundary */}
                <circle
                    cx={slingshotCenterX}
                    cy={slingshotCenterY}
                    r={boundaryRadius}
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.2)"
                    strokeWidth={2}
                    strokeDasharray="8,8"
                />

                {/* Slingshot Image - The draggable element */}
                <image
                    href={slingCenterImg}
                    x={pullEndX - 35}
                    y={pullEndY - 35}
                    width={70}
                    height={70}
                    style={{
                        filter: isDragging ? 'drop-shadow(0 0 20px rgba(103, 80, 164, 0.8))' : 'drop-shadow(0 0 10px rgba(255, 255, 255, 0.5))',
                        transition: isDragging ? 'none' : 'all 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)',
                        cursor: 'grab',
                    }}
                />

                {/* Aiming help line */}
                {isDragging && (
                    <line
                        x1={slingshotCenterX} y1={slingshotCenterY}
                        x2={pullEndX} y2={pullEndY}
                        stroke="rgba(255,255,255,0.15)" strokeWidth={2} strokeDasharray="5,5"
                    />
                )}
            </svg>

            {/* Instructions — context-aware */}
            {!isDragging && !hasSelectedThisRound && (
                <div style={{
                    position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%, -50%)',
                    textAlign: 'center', opacity: 0.4, pointerEvents: 'none',
                }}>
                    <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', marginBottom: '0.5rem' }}>Pull to Aim</p>
                    <p style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>Release to Shoot</p>
                </div>
            )}
        </div>
    );
}
