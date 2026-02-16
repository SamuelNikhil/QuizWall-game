// ==========================================
// Controller Page — Presentation Layer
// Slingshot / Gyro input + Lobby integration
// ==========================================

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { GameClient } from '../transport/GameClient';
import Lobby from './Lobby';
import type { LobbyState, PlayerRole, ScoreUpdate } from '../shared/types';
import '../index.css';
import '../animations.css';

type ControllerPhase = 'connecting' | 'lobby' | 'playing' | 'game-over';

export default function Controller() {
    const { roomId, token } = useParams<{ roomId: string; token: string }>();

    // ---- Connection ----
    const [phase, setPhase] = useState<ControllerPhase>('connecting');
    const [role, setRole] = useState<PlayerRole>('member');
    const [lobby, setLobby] = useState<LobbyState | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Persistent clientId to survive reloads/React double-mounts
    const clientIdRef = useRef<string>(
        sessionStorage.getItem('slingshot_client_id') ||
        Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );

    useEffect(() => {
        if (!sessionStorage.getItem('slingshot_client_id')) {
            sessionStorage.setItem('slingshot_client_id', clientIdRef.current);
        }
    }, []);

    // ---- Game state (from server) ----
    const [teamScore, setTeamScore] = useState(0);
    const [timeLeft, setTimeLeft] = useState(30);
    const [finalScore, setFinalScore] = useState(0);
    const [lastHit, setLastHit] = useState<{ correct: boolean } | null>(null);

    // ---- Slingshot state ----
    const [isDragging, setIsDragging] = useState(false);
    const [pullBack, setPullBack] = useState(0);
    const [power, setPower] = useState(0);
    const [targetXPercent, setTargetXPercent] = useState(50);
    const [targetYPercent, setTargetYPercent] = useState(50);
    const [aimAngle, setAimAngle] = useState(0);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });

    // ---- Gyroscope ----
    const [gyroEnabled, setGyroEnabled] = useState(false);
    const [gyroCalibration, setGyroCalibration] = useState({ alpha: 0, beta: 0, gamma: 0 });

    const clientRef = useRef<GameClient | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

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
                console.log(`[Room] Role assigned: ${data.role}`);
                setRole(data.role!);
                setPhase('lobby');
            });

            client.onLobbyUpdate((data) => {
                setLobby(data);
            });

            client.onGameStarted(() => {
                setPhase('playing');
                setTeamScore(0);
            });

            client.onTimerSync((data) => {
                setTimeLeft(data.timeLeft);
            });

            client.onScoreUpdate((data: ScoreUpdate) => {
                setTeamScore(data.teamScore);
            });

            client.onHitResult((data) => {
                setLastHit({ correct: data.correct });
                // Haptic feedback
                if ('vibrate' in navigator) {
                    navigator.vibrate(data.correct ? [50, 50, 50] : [200]);
                }
                setTimeout(() => setLastHit(null), 800);
            });

            client.onGameOver((data) => {
                setFinalScore(data.finalScore);
                setPhase('game-over');
            });

            client.onGameRestarted(() => {
                setPhase('lobby');
                setTeamScore(0);
                setTimeLeft(30);
            });
        }).catch((err) => {
            console.error('Connection failed:', err);
            setError('Connection failed');
        });

        return () => { client.close(); };
    }, [roomId, token]);

    // ---- Gyroscope handler ----
    useEffect(() => {
        if (!isDragging || !gyroEnabled || phase !== 'playing') return;

        const handleOrientation = (event: DeviceOrientationEvent) => {
            const beta = event.beta ?? 0;
            const gamma = event.gamma ?? 0;

            const relGamma = gamma - gyroCalibration.gamma;
            const relBeta = beta - gyroCalibration.beta;

            // Map to screen percentage
            // - Tilting phone RIGHT (gamma+) moves target RIGHT (x+)
            // - Tilting phone DOWN/FORWARD (beta+) moves target DOWN (y+)
            // Multipliers reduced for lower sensitivity (0.8 and 0.6)
            const x = Math.max(0, Math.min(100, 50 + relGamma * 0.8));
            const y = Math.max(0, Math.min(100, 50 + relBeta * 0.6));

            setTargetXPercent(x);
            setTargetYPercent(y);

            clientRef.current?.sendCrosshair(x, y);
        };

        window.addEventListener('deviceorientation', handleOrientation);
        return () => window.removeEventListener('deviceorientation', handleOrientation);
    }, [isDragging, gyroEnabled, gyroCalibration, phase]);

    // ---- Gyro permission request ----
    const requestGyroPermission = useCallback(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const DeviceOrientationEvent_ = DeviceOrientationEvent as any;
        if (typeof DeviceOrientationEvent_.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent_.requestPermission();
                if (permission === 'granted') {
                    setGyroEnabled(true);
                    // Calibrate on next reading
                    const onCalibrate = (e: DeviceOrientationEvent) => {
                        setGyroCalibration({ alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0 });
                        window.removeEventListener('deviceorientation', onCalibrate);
                    };
                    window.addEventListener('deviceorientation', onCalibrate);
                }
            } catch {
                console.log('Gyro permission denied');
            }
        } else {
            setGyroEnabled(true);
            const onCalibrate = (e: DeviceOrientationEvent) => {
                setGyroCalibration({ alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0 });
                window.removeEventListener('deviceorientation', onCalibrate);
            };
            window.addEventListener('deviceorientation', onCalibrate);
        }
    }, []);

    // Auto-request gyro on HTTPS mount
    useEffect(() => {
        if (window.location.protocol === 'https:' && phase === 'lobby') {
            requestGyroPermission();
        }
    }, [requestGyroPermission, phase]);

    // ---- Slingshot touch handlers ----

    const handleStart = useCallback(() => {
        if (phase !== 'playing') return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        setIsDragging(true);
        // Fixed center start position
        setStartPos({ x: rect.width / 2, y: rect.height / 2 });
        setPullBack(0);
        setPower(0);

        clientRef.current?.sendStartAiming(gyroEnabled);
    }, [phase, gyroEnabled]);

    const handleMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        if (!isDragging || phase !== 'playing') return;

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

        if (!gyroEnabled) {
            // Map pull direction to screen target
            const tX = Math.max(0, Math.min(100, 50 + (dx / maxPull) * 50));
            const tY = Math.max(0, Math.min(100, 50 - (dy / maxPull) * 50));
            setTargetXPercent(tX);
            setTargetYPercent(tY);
            clientRef.current?.sendCrosshair(tX, tY);
        }
    }, [isDragging, startPos, gyroEnabled, phase]);

    const handleEnd = useCallback(() => {
        if (!isDragging) return;

        if (power > 10 && phase === 'playing') {
            clientRef.current?.shoot(targetXPercent, targetYPercent, power / 100);
        } else {
            clientRef.current?.sendCancelAiming();
        }

        setIsDragging(false);
        setPullBack(0);
        setPower(0);
    }, [isDragging, power, targetXPercent, targetYPercent, phase]);

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
                lobby={lobby}
                onSetTeamName={(name) => clientRef.current?.setTeamName(name)}
                onReady={() => clientRef.current?.playerReady()}
                onStartGame={() => {
                    console.log('[Lobby] Leader clicked Start Game');
                    clientRef.current?.startGame();
                }}
                gyroEnabled={gyroEnabled}
                onRequestGyro={requestGyroPermission}
            />
        );
    }

    // ---- Game Over ----
    if (phase === 'game-over') {
        return (
            <div className="controller-container" style={{ justifyContent: 'center', alignItems: 'center', padding: '2rem' }}>
                <div style={{ textAlign: 'center', animation: 'bounceIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                    <h1 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#ff4444' }}>TIME'S UP!</h1>
                    <div style={{ background: 'var(--glass-bg)', padding: '2rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--glass-border)', margin: '1.5rem 0' }}>
                        <p style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '0.5rem' }}>Team Score</p>
                        <p style={{ fontSize: '3.5rem', fontWeight: 900, color: '#90e0ef' }}>{finalScore}</p>
                    </div>
                    {role === 'leader' && (
                        <button
                            onClick={() => clientRef.current?.restartGame()}
                            style={{ padding: '1rem 3rem', fontSize: '1.2rem', fontWeight: 800, background: 'var(--accent-primary)', border: 'none', borderRadius: 'var(--radius-md)', color: 'white', cursor: 'pointer', boxShadow: '0 8px 25px rgba(103, 80, 164, 0.5)' }}
                        >
                            🔄 Play Again
                        </button>
                    )}
                    {role !== 'leader' && (
                        <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Waiting for leader to restart...</p>
                    )}
                </div>
            </div>
        );
    }

    // ---- Playing (Slingshot) ----
    const width = containerRef.current?.offsetWidth || 400;
    const height = containerRef.current?.offsetHeight || 800;
    const slingshotCenterX = width / 2;
    const slingshotCenterY = height / 2; // Moved to center

    // Slingshot boundary radius
    const boundaryRadius = 100;

    const pullEndX = isDragging ? slingshotCenterX - Math.cos(aimAngle) * pullBack : slingshotCenterX;
    const pullEndY = isDragging ? slingshotCenterY - Math.sin(aimAngle) * pullBack : slingshotCenterY;

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

            {/* Header */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '0.6rem 1rem', borderRadius: 'var(--radius-md)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <span style={{ fontSize: '1.4rem' }}>{role === 'leader' ? '👑' : '🎮'}</span>
                    <span style={{ fontWeight: 800, color: '#fff', fontSize: '1rem', letterSpacing: '0.5px' }}>Score: {teamScore}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.6rem 1rem', borderRadius: 'var(--radius-md)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <span style={{ fontWeight: 800, color: timeLeft <= 10 ? '#ff6b6b' : '#fff', fontSize: '1.1rem', fontVariantNumeric: 'tabular-nums' }}>
                            {timeLeft}s
                        </span>
                    </div>
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
            </div>

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

                {/* Slingshot Joystick Handle */}
                <circle
                    cx={pullEndX} cy={pullEndY} r={35}
                    fill={isDragging ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)'}
                    stroke="rgba(255,255,255,0.3)" strokeWidth={2}
                    style={{
                        filter: isDragging ? 'drop-shadow(0 0 20px rgba(103, 80, 164, 0.8))' : 'none',
                        transition: isDragging ? 'none' : 'all 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)'
                    }}
                />

                {/* Aiming help */}
                {isDragging && !gyroEnabled && (
                    <line
                        x1={pullEndX} y1={pullEndY}
                        x2={pullEndX + (slingshotCenterX - pullEndX) * 2}
                        y2={pullEndY + (slingshotCenterY - pullEndY) * 2}
                        stroke="rgba(255,255,255,0.15)" strokeWidth={2} strokeDasharray="5,5"
                    />
                )}
            </svg>

            {/* Instructions */}
            {!isDragging && (
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
