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
import '../index.css';
import '../animations.css';
import './controller-ui.css';
import { soundManager } from '../utils/sound';
import WinnerScene from '../components/WinnerScene';
import slingCenterImg from '../assets/sling-center.svg';


type ControllerPhase = 'connecting' | 'lobby' | 'loading' | 'playing' | 'game-over';

const TOTAL_QUESTIONS = 10;
const CONTROLLER_AVATARS = ['wulf', 'talon', 'ryker', 'roux'] as const;
const SUCCESS_PARTICLES = [
    { left: '6%', bottom: '8%', size: '1.5rem', rotate: '-18deg', delay: '0s', variant: 'bar' },
    { left: '14%', bottom: '24%', size: '0.85rem', rotate: '18deg', delay: '0.12s', variant: 'spark' },
    { left: '24%', bottom: '18%', size: '1rem', rotate: '-30deg', delay: '0.25s', variant: 'bar' },
    { left: '30%', bottom: '34%', size: '0.8rem', rotate: '0deg', delay: '0.1s', variant: 'spark' },
    { left: '40%', bottom: '12%', size: '1.75rem', rotate: '-12deg', delay: '0.2s', variant: 'bar' },
    { left: '52%', bottom: '26%', size: '0.9rem', rotate: '0deg', delay: '0.3s', variant: 'spark' },
    { left: '62%', bottom: '14%', size: '1.2rem', rotate: '24deg', delay: '0.15s', variant: 'bar' },
    { left: '72%', bottom: '32%', size: '0.9rem', rotate: '0deg', delay: '0.28s', variant: 'spark' },
    { left: '80%', bottom: '20%', size: '1.1rem', rotate: '-24deg', delay: '0.18s', variant: 'bar' },
    { left: '90%', bottom: '10%', size: '1.4rem', rotate: '18deg', delay: '0.35s', variant: 'bar' },
] as const;

function hexToRgba(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '');
    const safeHex = normalized.length === 3
        ? normalized.split('').map((char) => char + char).join('')
        : normalized;

    const r = parseInt(safeHex.slice(0, 2), 16);
    const g = parseInt(safeHex.slice(2, 4), 16);
    const b = parseInt(safeHex.slice(4, 6), 16);

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function Controller() {
    const { roomId, token } = useParams<{ roomId: string; token: string }>();

    // ---- Connection ----
    const [phase, setPhase] = useState<ControllerPhase>('connecting');
    const phaseRef = useRef<ControllerPhase>('connecting');
    const setPhaseSync = (p: ControllerPhase) => { phaseRef.current = p; setPhase(p); };
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
    const [questionNumber, setQuestionNumber] = useState(0);
    const currentPhaseRef = useRef<QuestionPhase | null>(null);
    const hasSelectedRef = useRef(false);
    const isMultiplayerRef = useRef(false);

    // Loading screen state
    const [countdownActive, setCountdownActive] = useState(false);
    const [countdownValue, setCountdownValue] = useState(3);

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
    const loadingCountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

    const scheduleTimeout = useCallback((cb: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
        const timeoutId = setTimeout(() => {
            pendingTimeoutsRef.current.delete(timeoutId);
            cb();
        }, delayMs);
        pendingTimeoutsRef.current.add(timeoutId);
        return timeoutId;
    }, []);

    const clearAllScheduledTimeouts = useCallback(() => {
        pendingTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
        pendingTimeoutsRef.current.clear();
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

            client.onLoadingStart((data) => {
                console.log('[Controller] Loading started, players:', data.playerCount);
                setPhaseSync('loading');
                if (loadingCountdownIntervalRef.current) {
                    clearInterval(loadingCountdownIntervalRef.current);
                    loadingCountdownIntervalRef.current = null;
                }
                setCountdownActive(false);
            });

            client.onLoadingCountdown((data) => {
                console.log('[Controller] Countdown starting:', data.duration);
                setCountdownActive(true);
                setCountdownValue(data.duration);

                if (loadingCountdownIntervalRef.current) {
                    clearInterval(loadingCountdownIntervalRef.current);
                    loadingCountdownIntervalRef.current = null;
                }
                let count = data.duration;
                soundManager.playCountdownBeep();
                loadingCountdownIntervalRef.current = setInterval(() => {
                    count--;
                    if (count > 0) {
                        soundManager.playCountdownBeep();
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

            client.onGameStarted(() => {
                console.log('[Controller] Game started event, transitioning to playing');
                setPhaseSync('playing');
                setQuestionNumber(1);
                if (loadingCountdownIntervalRef.current) {
                    clearInterval(loadingCountdownIntervalRef.current);
                    loadingCountdownIntervalRef.current = null;
                }
                setCountdownActive(false);
            });

            client.onQuestion(() => {
                if (!isMultiplayerRef.current) {
                    setQuestionNumber((prev) => prev + 1);
                }
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
                scheduleTimeout(() => setLastHit(null), 800);

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
                    scheduleTimeout(() => {
                        setScorePopups(prev => prev.filter(p => p.id !== popupId));
                    }, 2000);
                }
            });

            client.onGameOver((data) => {
                setPlayerScores(data.playerScores || []);
                setPhaseSync('game-over');
            });

            // Phase-based multiplayer events
            client.onPhaseChange((data) => {
                console.log('[Controller] Phase change:', data.phase, 'time:', data.timeLeft, 'current phase:', phaseRef.current);
                setCurrentPhase(data.phase);
                currentPhaseRef.current = data.phase;
                setPhaseTimeLeft(data.timeLeft);
                setQuestionNumber(data.questionNumber);
                setIsMultiplayer(true);
                isMultiplayerRef.current = true;
                // Transition from loading to playing when first phase starts
                if (phaseRef.current === 'loading' && (data.phase === 'selection' || data.phase === 'analysis')) {
                    setPhaseSync('playing');
                    if (loadingCountdownIntervalRef.current) {
                        clearInterval(loadingCountdownIntervalRef.current);
                        loadingCountdownIntervalRef.current = null;
                    }
                    setCountdownActive(false);
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
                scheduleTimeout(() => setLastHit(null), 1500);

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
                    scheduleTimeout(() => {
                        setScorePopups(prev => prev.filter(p => p.id !== popupId));
                    }, 2000);
                }
            });

            client.onGameRestarted(() => {
                setPhaseSync('lobby');
                setIsSpectating(false);
                setPlayerScores([]);
                setTimeLeft(20);
                setCurrentPhase(null);
                currentPhaseRef.current = null;
                setHasSelectedThisRound(false);
                hasSelectedRef.current = false;
                setIsMultiplayer(false);
                isMultiplayerRef.current = false;
                setQuestionNumber(0);
                if (loadingCountdownIntervalRef.current) {
                    clearInterval(loadingCountdownIntervalRef.current);
                    loadingCountdownIntervalRef.current = null;
                }
                setCountdownActive(false);
            });

            // Server-authoritative session expiry — reaper killed the room due to inactivity.
            client.onRoomExpired(() => {
                console.log('[Controller] room:expired received, session timed out');
                setError('Session expired due to inactivity');
                scheduleTimeout(() => {
                    window.location.href = '/';
                }, 2000);
            });

            // Tutorial status updates - removed
            // Tutorial status updates - removed
        }).catch((err) => {
            console.error('Connection failed:', err);
            setError('Connection failed');
        });

        return () => {
            if (loadingCountdownIntervalRef.current) {
                clearInterval(loadingCountdownIntervalRef.current);
                loadingCountdownIntervalRef.current = null;
            }
            clearAllScheduledTimeouts();
            client.close();
        };
    }, [roomId, token, clearAllScheduledTimeouts, scheduleTimeout]);

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

        // Don't send startAiming - keep crosshair visible during aiming
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

        // Shoot first, then cancel crosshair
        if (power > 10 && phase === 'playing') {
            clientRef.current?.shoot(targetXPercent, targetYPercent, power / 100);
            // Cancel crosshair after shooting
            clientRef.current?.sendCancelAiming();
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
                colorIndex={lobby?.players.find((p) => p.id === clientIdRef.current)?.colorIndex ?? colorIndex}
                lobby={lobby}
                persistentName={persistentName || undefined}
                onSetPlayerName={(name) => clientRef.current?.setPlayerName(name)}
                onReady={() => clientRef.current?.setReady()}
                onStartGame={() => {
                    console.log('[Controller] onStartGame called, emitting START_GAME');
                    clientRef.current?.startGame();
                }}
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
    const activeColorIndex = lobby?.players.find((p) => p.id === clientIdRef.current)?.colorIndex ?? colorIndex;
    const slingshotCenterX = width / 2;
    const slingshotCenterY = height / 2;
    const boundaryRadius = 100;
    const pullEndX = isDragging ? slingshotCenterX - Math.cos(aimAngle) * pullBack : slingshotCenterX;
    const pullEndY = isDragging ? slingshotCenterY - Math.sin(aimAngle) * pullBack : slingshotCenterY;
    const pullOffsetX = pullEndX - slingshotCenterX;
    const pullOffsetY = pullEndY - slingshotCenterY;

    // ---- Loading Questions Phase ----
    if (phase === 'loading') {
        const myColor = CROSSHAIR_COLORS[activeColorIndex] || '#6750A4';
        const preConfigAvatars = ["wulf", "talon", "ryker", "roux"];
        const preConfigNames = ["Wulf", "Talon", "Ryker", "Roux"];
        const characterAvatar = preConfigAvatars[activeColorIndex] || 'wulf';
        const characterName = preConfigNames[activeColorIndex] || `Player ${activeColorIndex + 1}`;

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
                        borderTop: `4px solid #ff9500`,
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
                    {countdownActive ? 'First question incoming' : 'The question is coming'}
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

    // ---- Game Over ----
    if (phase === 'game-over') {
        return (
            <WinnerScene
                variant="controller"
                scores={playerScores}
                role={role}
                currentControllerId={clientIdRef.current}
                onRestart={() => clientRef.current?.restartGame()}
                onClose={() => {
                    clientRef.current?.close();
                    window.location.href = '/';
                }}
            />
        );

        const isCompleted = false;
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

    const characterAvatar = CONTROLLER_AVATARS[activeColorIndex] || 'wulf';
    const controllerAccent = CROSSHAIR_COLORS[activeColorIndex] || CROSSHAIR_COLORS[0];
    const currentScore = playerScores.find((p) => p.controllerId === clientIdRef.current)?.score ?? 0;
    const latestPopup = scorePopups[scorePopups.length - 1] ?? null;
    const displayQuestionNumber = Math.max(1, questionNumber || 1);
    const isAnswerLocked = isMultiplayer && hasSelectedThisRound && currentPhase === 'selection';
    const isAnalysisPhase = isMultiplayer && currentPhase === 'analysis' && phase === 'playing';
    const showSuccessCelebration = Boolean(latestPopup);
    const showAimHint = !isDragging && !isAnswerLocked && !isAnalysisPhase && !lastHit;
    const showPowerMeter = isDragging && !lastHit;
    const showCorrectScore = showSuccessCelebration;
    const controllerTone =
        showSuccessCelebration ? 'success' :
            lastHit?.correct ? 'success' :
            lastHit ? 'danger' :
                isAnswerLocked ? 'locked' :
                    isDragging ? 'aiming' :
                        isAnalysisPhase ? 'analysis' :
                            'default';

    return (
        <div
            ref={containerRef}
            className={`controller-container controller-playfield controller-playfield--${controllerTone}`}
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
            onTouchCancel={handleEnd}
            onMouseDown={handleStart}
            onMouseMove={handleMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            style={{
                position: 'relative',
                overflow: 'hidden',
                touchAction: 'none',
                '--controller-accent': controllerAccent,
                '--controller-accent-soft': hexToRgba(controllerAccent, 0.22),
                '--controller-accent-glow': hexToRgba(controllerAccent, 0.16),
                '--controller-accent-ambient': hexToRgba(controllerAccent, 0.08),
                '--controller-accent-ambient-strong': hexToRgba(controllerAccent, 0.12),
                '--controller-accent-core': hexToRgba(controllerAccent, 0.26),
                '--controller-accent-border': hexToRgba(controllerAccent, 0.28),
                '--controller-accent-copy': hexToRgba(controllerAccent, 0.72),
            } as React.CSSProperties}
        >
            <div className="controller-playfield__background" />
            <div className="controller-playfield__ambient" />

            {showSuccessCelebration && (
                <div className="controller-success-particles" aria-hidden="true">
                    {SUCCESS_PARTICLES.map((particle, index) => (
                        <span
                            key={`${particle.left}-${index}`}
                            className={`controller-success-particle controller-success-particle--${particle.variant}`}
                            style={{
                                left: particle.left,
                                bottom: particle.bottom,
                                width: particle.variant === 'spark' ? particle.size : `calc(${particle.size} * 0.8)`,
                                height: particle.size,
                                transform: `rotate(${particle.rotate})`,
                                animationDelay: particle.delay,
                            }}
                        />
                    ))}
                </div>
            )}

            <header className="controller-shell__topbar">
                <div className="controller-score-label">
                    <span aria-hidden="true">&#x1F451;</span>
                    <span>Score: {currentScore}</span>
                </div>

                <div className="controller-question-label">Q{displayQuestionNumber}/{TOTAL_QUESTIONS}</div>

                <button
                    className="controller-close-button"
                    onTouchStart={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => {
                        if (phase === 'playing') {
                            clientRef.current?.sendLeaveGame();
                            setIsSpectating(true);
                            setPhase('lobby');
                        } else {
                            clientRef.current?.close();
                            window.location.href = '/';
                        }
                    }}
                    aria-label="Leave controller"
                    type="button"
                >
                    &times;
                </button>
            </header>

            <div className="controller-shell__center">
                <p className="controller-release-copy">Release to Shoot</p>

                <div
                    className={`controller-crosshair ${isDragging ? 'is-active' : ''}`}
                    style={{
                        transform: `translate(calc(-50% + ${pullOffsetX}px), calc(-50% + ${pullOffsetY}px))`,
                    }}
                >
                    <span className="controller-crosshair__line controller-crosshair__line--vertical" />
                    <span className="controller-crosshair__line controller-crosshair__line--horizontal" />
                    <div className="controller-avatar-core">
                        <div className="controller-avatar-core__halo" />
                        <img
                            src={`/avatars/${characterAvatar}.png`}
                            alt=""
                            className="controller-avatar-core__image"
                            draggable={false}
                        />
                    </div>
                </div>
            </div>

            <div className="controller-shell__bottom">
                {showCorrectScore && latestPopup && (
                    <div key={latestPopup.id} className="controller-bottom-score">
                        {latestPopup.score}
                    </div>
                )}

                {showPowerMeter && (
                    <div className="controller-bottom-score controller-bottom-score--power">
                        {Math.max(0, Math.round(power))}
                    </div>
                )}

                {isAnswerLocked && (
                    <div className="controller-lock-pill">
                        <span className="controller-lock-pill__title">Answer Locked</span>
                        <span className="controller-lock-pill__meta">Option {selectedOrbId || '?'}</span>
                    </div>
                )}

                {isAnalysisPhase && (
                    <div className="controller-phase-pill">
                        Selection opens in {phaseTimeLeft}s
                    </div>
                )}

                {showAimHint && (
                    <div className="controller-bottom-hint">DRAG TO AIM</div>
                )}
            </div>
        </div>
    );

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
                        background: lastHit?.correct
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

            {/* Header — Redesigned to match Screen UI */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
                {/* LIVE NOW Badge */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.4rem 1rem',
                    background: 'rgba(255, 68, 68, 0.1)',
                    borderRadius: '20px',
                    border: '1px solid rgba(255, 68, 68, 0.2)',
                }}>
                    <span style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: '#ff4444',
                        boxShadow: '0 0 8px #ff4444',
                        animation: 'pulse 1s ease-in-out infinite',
                    }} />
                    <span style={{
                        fontSize: '0.65rem',
                        fontWeight: 900,
                        color: '#ff4444',
                        letterSpacing: '1px',
                    }}>
                        LIVE
                    </span>
                </div>

                {/* Timer / Phase Indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {isMultiplayer && currentPhase ? (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            background: 'rgba(255,255,255,0.06)',
                            padding: '0.4rem 0.8rem', borderRadius: '16px',
                            border: '1px solid rgba(255,255,255,0.1)',
                        }}>
                            <span style={{ fontWeight: 900, fontSize: '1.2rem', color: phaseTimeLeft <= 3 ? '#ff4444' : '#fff', fontVariantNumeric: 'tabular-nums' }}>
                                {phaseTimeLeft}s
                            </span>
                        </div>
                    ) : (
                        <div style={{
                            background: 'rgba(255,255,255,0.06)',
                            padding: '0.4rem 0.8rem', borderRadius: '16px',
                            border: '1px solid rgba(255,255,255,0.1)',
                        }}>
                            <span style={{ fontWeight: 900, color: timeLeft <= 5 ? '#ff4444' : '#fff', fontSize: '1.2rem', fontVariantNumeric: 'tabular-nums' }}>
                                {timeLeft}s
                            </span>
                        </div>
                    )}
                    
                    {/* Leave button */}
                    <button
                        onClick={() => {
                            if (phase === 'playing') {
                                clientRef.current?.sendLeaveGame();
                                setIsSpectating(true);
                                setPhase('lobby');
                            } else {
                                clientRef.current?.close();
                                window.location.href = '/';
                            }
                        }}
                        style={{
                            width: '36px', height: '36px', borderRadius: '50%',
                            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                            color: '#fff', fontSize: '1rem', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            backdropFilter: 'blur(10px)', transition: 'all 0.2s ease',
                        }}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Question Number Badge */}
            {questionNumber > 0 && (
                <div style={{
                    position: 'absolute',
                    top: '4rem',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 10,
                }}>
                    <span style={{
                        fontSize: '0.65rem',
                        fontWeight: 800,
                        color: 'rgba(255,255,255,0.35)',
                        letterSpacing: '2px',
                        textTransform: 'uppercase',
                    }}>
                        Question {questionNumber}/10
                    </span>
                </div>
            )}

            {/* Score Display */}
            <div style={{
                position: 'absolute',
                top: '5.5rem',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 10,
            }}>
                <span style={{
                    fontSize: '1.5rem',
                    fontWeight: 900,
                    color: CROSSHAIR_COLORS[colorIndex],
                    textShadow: `0 0 20px ${CROSSHAIR_COLORS[colorIndex]}60`,
                    fontVariantNumeric: 'tabular-nums',
                }}>
                    {playerScores.find(p => p.controllerId === clientIdRef.current)?.score ?? 0}
                </span>
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
