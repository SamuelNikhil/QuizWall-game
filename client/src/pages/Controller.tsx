// ==========================================
// Controller Page — Presentation Layer
// Slingshot / Gyro input + Lobby integration
// ==========================================

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { GameClient } from '../transport/GameClient';
import Lobby from './Lobby';
import type { LobbyState, PlayerRole, ScoreUpdate, QuestionPhase, PlayerSelectionPayload, RevealResultPayload, TutorialStep, TutorialStatusUpdatePayload, PlayerScoreEntry } from '../shared/types';
import { CROSSHAIR_COLORS } from '../shared/types';
import slingCenterImg from '../assets/sling-center.svg';
import '../index.css';
import '../animations.css';

type ControllerPhase = 'connecting' | 'lobby' | 'calibrating' | 'playing' | 'game-over';

export default function Controller() {
    const { roomId, token } = useParams<{ roomId: string; token: string }>();

    // ---- Connection ----
    const [phase, setPhase] = useState<ControllerPhase>('connecting');
    const [role, setRole] = useState<PlayerRole>('member');
    const [colorIndex, setColorIndex] = useState<number>(0);
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
    const [timeLeft, setTimeLeft] = useState(20);
    const [finalScore, setFinalScore] = useState(0);
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

    // ---- Gyro Calibration Tutorial State ----
    const calibrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ---- Interactive Tutorial State ----
    const [tutorialStep, setTutorialStep] = useState<TutorialStep>('waiting');
    const tutorialStepRef = useRef<TutorialStep>('waiting');
    const tutorialSlingDetected = useRef(false);
    const tutorialTiltLeftDetected = useRef(false);
    const tutorialTiltRightDetected = useRef(false);
    const tutorialTiltUpDetected = useRef(false);
    const tutorialTiltDownDetected = useRef(false);
    const lastTiltSendRef = useRef<number>(0); // throttle tilt position sends

    // ---- Gyroscope state - KEPT FOR FUTURE USE (currently disabled) ----
    // These are kept for potential future gyro re-enablement
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [gyroEnabled, setGyroEnabled] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [gyroCalibrated, setGyroCalibrated] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [gyroCalibration, setGyroCalibration] = useState({ alpha: 0, beta: 0, gamma: 0 });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const gyroPermissionRequested = useRef(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const orientationListenerActive = useRef(false);

    // Use refs for real-time values to avoid stale closures in gyro handler
    const isDraggingRef = useRef(false);
    const gyroCalibrationRef = useRef({ alpha: 0, beta: 0, gamma: 0 });
    const gyroEnabledRef = useRef(false);

    // Sync refs with state - gyro is always disabled so these stay false
    useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);
    useEffect(() => { gyroCalibrationRef.current = gyroCalibration; }, [gyroCalibration]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    useEffect(() => { gyroEnabledRef.current = gyroEnabled; }, [gyroEnabled]);
    useEffect(() => { tutorialStepRef.current = tutorialStep; }, [tutorialStep]);

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
                console.log(`[Room] Role assigned: ${data.role}, Color: ${data.colorIndex}`);
                setRole(data.role!);
                setColorIndex(data.colorIndex ?? 0);
                setPhase('lobby');
            });

            client.onLobbyUpdate((data) => {
                setLobby(data);
            });

            client.onRolePromoted((data) => {
                console.log('[Room] Role promoted to:', data.role);
                setRole(data.role);
            });

            client.onTutorialStart((_data: { duration: number }) => {
                console.log('[Controller] Tutorial started, interactive mode');
                setPhase('calibrating');
                setTutorialStep('waiting');
                tutorialStepRef.current = 'waiting';
                tutorialSlingDetected.current = false;
                tutorialTiltLeftDetected.current = false;
                tutorialTiltRightDetected.current = false;

                // If gyro is disabled, auto-complete the tutorial immediately
                if (!gyroEnabledRef.current) {
                    console.log('[Controller] Gyro disabled — auto-completing tutorial');
                    setTimeout(() => {
                        client.sendTutorialProgress({ step: 'sling' });
                        client.sendTutorialProgress({ step: 'tilt-left', tiltX: 10, tiltY: 50 });
                        client.sendTutorialProgress({ step: 'tilt-right', tiltX: 90, tiltY: 50 });
                        client.sendTutorialProgress({ step: 'tilt-up', tiltX: 50, tiltY: 10 });
                        client.sendTutorialProgress({ step: 'tilt-down', tiltX: 50, tiltY: 90 });
                    }, 300); // Small delay for server to register tutorial state
                }
            });

            client.onTutorialEnd(() => {
                console.log('[Controller] Tutorial ended');
                if (calibrationTimerRef.current) {
                    clearTimeout(calibrationTimerRef.current);
                    calibrationTimerRef.current = null;
                }
                setPhase('playing');
            });

            client.onGameStarted(() => {
                // Game started event - tutorial already handled this
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
                // Haptic feedback (safe for all browsers)
                try { navigator?.vibrate?.(data.correct ? [50, 50, 50] : [200]); } catch { /* unsupported */ }
                setTimeout(() => setLastHit(null), 800);
            });

            client.onGameOver((data) => {
                setFinalScore(data.finalScore);
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
                    try { navigator?.vibrate?.([30, 20, 30]); } catch { /* unsupported */ }
                } else {
                    console.log('[Controller] Other player selection:', _data.controllerId.substring(0, 8));
                }
            });

            client.onRevealResult((data: RevealResultPayload) => {
                console.log('[Controller] Reveal result:', data.anyCorrect ? 'correct!' : 'wrong');
                // Haptic feedback on reveal (safe for all browsers)
                try { navigator?.vibrate?.(data.anyCorrect ? [50, 50, 50] : [200]); } catch { /* unsupported */ }
                // Show visual hit feedback
                setLastHit({ correct: data.anyCorrect });
                setTimeout(() => setLastHit(null), 1500);

                // Show score popup ONLY for this player (not all players)
                if (data.playerScores) {
                    const myScore = data.playerScores.find(ps => ps.controllerId === clientIdRef.current);
                    if (myScore && myScore.correct && myScore.score > 0) {
                        const popupId = `score-${Date.now()}-${myScore.controllerId}`;
                        setScorePopups(prev => [...prev, { 
                            id: popupId, 
                            score: myScore.score, 
                            bonus: myScore.bonus, 
                            colorIndex: myScore.colorIndex 
                        }]);
                        // Remove popup after animation
                        setTimeout(() => {
                            setScorePopups(prev => prev.filter(p => p.id !== popupId));
                        }, 2000);
                    }
                }
            });

            client.onGameRestarted(() => {
                setPhase('lobby');
                setTeamScore(0);
                setTimeLeft(20);
                setCurrentPhase(null);
                currentPhaseRef.current = null;
                setHasSelectedThisRound(false);
                hasSelectedRef.current = false;
                setIsMultiplayer(false);
                setTutorialStep('waiting');
                tutorialStepRef.current = 'waiting';
                tutorialSlingDetected.current = false;
                tutorialTiltLeftDetected.current = false;
                tutorialTiltRightDetected.current = false;
                tutorialTiltUpDetected.current = false;
                tutorialTiltDownDetected.current = false;
            });

            // Tutorial status updates from server
            client.onTutorialStatusUpdate((data: TutorialStatusUpdatePayload) => {
                // Update our own step from server state
                const myClientId = clientIdRef.current;
                const myStatus = data.players.find(p => p.controllerId === myClientId);
                if (myStatus && myStatus.currentStep !== tutorialStepRef.current) {
                    setTutorialStep(myStatus.currentStep);
                    tutorialStepRef.current = myStatus.currentStep;
                }
            });
        }).catch((err) => {
            console.error('Connection failed:', err);
            setError('Connection failed');
        });

        return () => { client.close(); };
    }, [roomId, token]);

    // ---- Gyroscope handler - ACTIVE LISTENER (works for both iOS and Android) ----
    // This keeps the orientation listener attached whenever gyro is enabled, not just during dragging
    // iOS Safari requires the listener to be active to receive any deviceorientation events
    useEffect(() => {
        if (!gyroEnabled || (phase !== 'playing' && phase !== 'calibrating')) {
            // Clean up when not in playing/calibrating phase or gyro disabled
            if (orientationListenerActive.current) {
                window.removeEventListener('deviceorientation', handleGyroOrientation);
                orientationListenerActive.current = false;
            }
            return;
        }

        // Attach listener when gyro is enabled and in playing or calibrating phase
        if (!orientationListenerActive.current) {
            window.addEventListener('deviceorientation', handleGyroOrientation, true);
            orientationListenerActive.current = true;
            console.log('[Gyro] Orientation listener attached');
        }

        return () => {
            window.removeEventListener('deviceorientation', handleGyroOrientation);
            orientationListenerActive.current = false;
            console.log('[Gyro] Orientation listener detached');
        };
    }, [gyroEnabled, phase]);

    // Cleanup calibration timer on unmount
    useEffect(() => {
        return () => {
            if (calibrationTimerRef.current) {
                clearTimeout(calibrationTimerRef.current);
            }
        };
    }, []);

    // ---- Screen Wake Lock — prevent phone from sleeping during gameplay ----
    useEffect(() => {
        if (phase !== 'playing' && phase !== 'calibrating') {
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
            if (document.visibilityState === 'visible' && (phase === 'playing' || phase === 'calibrating')) {
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

    // Gyro orientation handler - uses refs for real-time values, sends crosshair for visual feedback
    // Works during calibration (always) and playing (only when dragging)
    const handleGyroOrientation = useCallback((event: DeviceOrientationEvent) => {
        if (!gyroEnabledRef.current || (phase !== 'playing' && phase !== 'calibrating')) return;

        // During playing phase, only process when dragging (slingshot pulled)
        if (phase === 'playing' && !isDraggingRef.current) return;

        const beta = event.beta ?? 0;
        const gamma = event.gamma ?? 0;

        // Apply calibration offset from ref (real-time)
        const relGamma = gamma - gyroCalibrationRef.current.gamma;
        const relBeta = beta - gyroCalibrationRef.current.beta;

        // Map to screen percentage
        // - X: Tilting phone RIGHT (gamma+) moves target RIGHT (x+)
        // - Y: Tilting phone FORWARD/AWAY (beta+) moves target UP (y-)
        const x = Math.max(0, Math.min(100, 50 + relGamma * 1.0));
        const y = Math.max(0, Math.min(100, 50 - relBeta * 0.8));

        // During calibration, update calibration tilt for visual feedback
        if (phase === 'calibrating') {
            // Only process gyro tilt AFTER the sling is completed
            if (!tutorialSlingDetected.current) return;

            // Update local coords so the mini crosshair on controller moves smoothly
            setTargetXPercent(x);
            setTargetYPercent(y);

            // Throttled: stream tilt position to server for Screen crosshair (~20fps)
            const now = Date.now();
            if (now - lastTiltSendRef.current >= 50) {
                lastTiltSendRef.current = now;
                clientRef.current?.sendTutorialProgress({ step: 'tilt-left', tiltX: x, tiltY: y });
            }

            // Tutorial: detect tilt-left (x < 20)
            if (tutorialSlingDetected.current && !tutorialTiltLeftDetected.current && x < 20 && isDraggingRef.current) {
                tutorialTiltLeftDetected.current = true;
                clientRef.current?.sendTutorialProgress({ step: 'tilt-left', tiltX: x, tiltY: y });
                console.log('[Tutorial] Tilt-LEFT detected!');
                try { navigator?.vibrate?.(30); } catch { /* unsupported */ }
            }

            // Tutorial: detect tilt-right (x > 80)
            if (tutorialSlingDetected.current && !tutorialTiltRightDetected.current && x > 80 && isDraggingRef.current) {
                tutorialTiltRightDetected.current = true;
                clientRef.current?.sendTutorialProgress({ step: 'tilt-right', tiltX: x, tiltY: y });
                console.log('[Tutorial] Tilt-RIGHT detected!');
                try { navigator?.vibrate?.(30); } catch { /* unsupported */ }
            }

            // Tutorial: detect tilt-up (y < 20)
            if (tutorialSlingDetected.current && !tutorialTiltUpDetected.current && y < 20 && isDraggingRef.current) {
                tutorialTiltUpDetected.current = true;
                clientRef.current?.sendTutorialProgress({ step: 'tilt-up', tiltX: x, tiltY: y });
                console.log('[Tutorial] Tilt-UP detected!');
                try { navigator?.vibrate?.(30); } catch { /* unsupported */ }
            }

            // Tutorial: detect tilt-down (y > 80)
            if (tutorialSlingDetected.current && !tutorialTiltDownDetected.current && y > 80 && isDraggingRef.current) {
                tutorialTiltDownDetected.current = true;
                clientRef.current?.sendTutorialProgress({ step: 'tilt-down', tiltX: x, tiltY: y });
                console.log('[Tutorial] Tilt-DOWN detected!');
                try { navigator?.vibrate?.([30, 50, 30]); } catch { /* unsupported */ }
            }

            return; // Don't send crosshair during calibration
        }

        // During playing, update target and send crosshair (only when dragging)
        setTargetXPercent(x);
        setTargetYPercent(y);

        // Send crosshair update for visual feedback on screen
        // Throttle to ~30fps to avoid overwhelming the network
        throttledSendCrosshair(x, y);
    }, [phase, throttledSendCrosshair]); // Only depend on phase and throttled function, use refs for everything else

    // ---- Gyro permission request - DISABLED FOR NOW, KEPT FOR FUTURE USE ----
    /*
    const requestGyroPermission = useCallback(async () => {
        // Prevent double requests
        if (gyroPermissionRequested.current) return;
        gyroPermissionRequested.current = true;

        console.log('[Gyro] Requesting permission...');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const DeviceOrientationEvent_ = DeviceOrientationEvent as any;

        // iOS 13+ requires explicit permission request
        if (typeof DeviceOrientationEvent_.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent_.requestPermission();
                console.log('[Gyro] iOS permission result:', permission);

                if (permission === 'granted') {
                    setGyroEnabled(true);
                    // iOS needs a moment to start sending events after permission grant
                    setTimeout(() => {
                        calibrateGyro();
                    }, 100);
                } else {
                    console.log('[Gyro] Permission denied by user');
                    alert('Motion access denied. Please enable in Settings > Safari > Motion & Orientation Access.');
                }
            } catch (err) {
                console.error('[Gyro] Permission request failed:', err);
            }
        } else {
            // Android/Desktop - no explicit permission needed
            console.log('[Gyro] Android/Desktop - enabling without explicit permission');
            setGyroEnabled(true);
            // Small delay to ensure sensor is ready
            setTimeout(() => {
                calibrateGyro();
            }, 100);
        }
    }, []);

    // Calibrate gyro - capture current position as "center"
    const calibrateGyro = useCallback(() => {
        if (!gyroEnabled && !orientationListenerActive.current) {
            console.log('[Gyro] Cannot calibrate - not enabled yet');
            return;
        }

        // Create a one-time calibration listener
        const calibrateOnce = (e: DeviceOrientationEvent) => {
            const calibration = {
                alpha: e.alpha ?? 0,
                beta: e.beta ?? 0,
                gamma: e.gamma ?? 0
            };
            setGyroCalibration(calibration);
            setGyroCalibrated(true);
            console.log('[Gyro] Calibrated:', calibration);
            window.removeEventListener('deviceorientation', calibrateOnce);
        };

        // Try to get immediate reading
        window.addEventListener('deviceorientation', calibrateOnce, { once: true });

        // Also try to force a reading by temporarily attaching a listener if not already active
        if (!orientationListenerActive.current) {
            const tempListener = (e: DeviceOrientationEvent) => {
                setGyroCalibration({
                    alpha: e.alpha ?? 0,
                    beta: e.beta ?? 0,
                    gamma: e.gamma ?? 0
                });
                setGyroCalibrated(true);
                console.log('[Gyro] Calibrated via temp listener:', e.gamma);
                window.removeEventListener('deviceorientation', tempListener);
            };
            window.addEventListener('deviceorientation', tempListener);
            // Remove after short delay if no event received
            setTimeout(() => {
                window.removeEventListener('deviceorientation', tempListener);
            }, 500);
        }
    }, [gyroEnabled]);

    // Recalibrate when gyro is enabled
    useEffect(() => {
        if (gyroEnabled && !gyroCalibrated) {
            calibrateGyro();
        }
    }, [gyroEnabled, gyroCalibrated, calibrateGyro]);
    */

    // ---- Slingshot touch handlers ----

    const handleStart = useCallback(() => {
        if (phase !== 'playing' && phase !== 'calibrating') return;
        // In multiplayer, only allow slingshot during selection phase and if not already selected
        if (phase === 'playing' && isMultiplayer && (currentPhaseRef.current !== 'selection' || hasSelectedRef.current)) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        setIsDragging(true);
        // Fixed center start position
        setStartPos({ x: rect.width / 2, y: rect.height / 2 });
        setPullBack(0);
        setPower(0);

        // Light haptic feedback when starting to pull the sling
        try { navigator?.vibrate?.(15); } catch { /* unsupported */ }

        if (phase === 'playing') {
            clientRef.current?.sendStartAiming();
        }
    }, [phase, gyroEnabled, isMultiplayer]);

    const handleMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        if (!isDragging || (phase !== 'playing' && phase !== 'calibrating')) return;

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
            // Map pull direction to screen target (x-axis inverted)
            const tX = Math.max(0, Math.min(100, 50 - (dx / maxPull) * 50));
            const tY = Math.max(0, Math.min(100, 50 - (dy / maxPull) * 50));
            setTargetXPercent(tX);
            setTargetYPercent(tY);
            if (phase === 'playing') {
                clientRef.current?.sendCrosshair(tX, tY);
            }
        }

        // Tutorial: detect sling action (power > 50%)
        if (phase === 'calibrating' && !tutorialSlingDetected.current && Math.min(100, (clampedDist / maxPull) * 100) > 50) {
            tutorialSlingDetected.current = true;
            clientRef.current?.sendTutorialProgress({ step: 'sling' });
            console.log('[Tutorial] Sling detected!');
            try { navigator?.vibrate?.(30); } catch { /* unsupported */ }
        }
    }, [isDragging, startPos, gyroEnabled, phase]);

    const handleEnd = useCallback(() => {
        if (!isDragging) return;

        // During tutorial, don't shoot, just release
        if (phase === 'calibrating') {
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
                lobby={lobby}
                colorIndex={colorIndex}
                onSetTeamName={(name) => clientRef.current?.setTeamName(name)}
                onSetPlayerName={(name) => clientRef.current?.setPlayerName(name)}
                onReady={() => clientRef.current?.playerReady()}
                onStartGame={() => {
                    console.log('[Lobby] Leader clicked Start Game - telling server to start');
                    // Server will send TUTORIAL_START which will trigger the calibration phase
                    // No optimistic UI - let server control the timing
                    clientRef.current?.startGame();
                }}
                onLeave={() => {
                    clientRef.current?.close();
                    window.location.href = '/';
                }}
            />
        );
    }

    // ---- Slingshot Layout Calculations (shared by calibrating + playing phases) ----
    const width = containerRef.current?.offsetWidth || 400;
    const height = containerRef.current?.offsetHeight || 800;
    const slingshotCenterX = width / 2;
    const slingshotCenterY = height / 2;
    const boundaryRadius = 100;
    const pullEndX = isDragging ? slingshotCenterX - Math.cos(aimAngle) * pullBack : slingshotCenterX;
    const pullEndY = isDragging ? slingshotCenterY - Math.sin(aimAngle) * pullBack : slingshotCenterY;

    // ---- Calibration Tutorial (Interactive) ----
    if (phase === 'calibrating') {
        const myColor = CROSSHAIR_COLORS[colorIndex];

        // Non-gyro player: show loading screen while questions are generated
        if (!gyroEnabled) {
            return (
                <div className="controller-container" style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    height: '100%', textAlign: 'center', padding: '2rem',
                }}>
                    <div style={{
                        background: 'var(--glass-bg)', padding: '2rem',
                        borderRadius: 'var(--radius-lg)', border: '1px solid var(--glass-border)',
                        backdropFilter: 'blur(20px)', maxWidth: '320px', width: '100%',
                    }}>
                        <div style={{
                            width: '40px', height: '40px', margin: '0 auto 1rem',
                            border: '3px solid rgba(255,255,255,0.1)', borderTop: `3px solid ${myColor}`,
                            borderRadius: '50%', animation: 'spin 1s linear infinite',
                        }} />
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 900, color: '#fff', margin: '0 0 0.5rem' }}>Loading Questions...</h2>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
                            AI is generating your questions
                        </p>
                    </div>
                </div>
            );
        }

        const isSlingPhase = tutorialStep === 'waiting' || tutorialStep === 'sling';
        const isTiltPhase = tutorialStep === 'tilt';
        const isComplete = tutorialStep === 'complete';
        const tiltLeft = tutorialTiltLeftDetected.current;
        const tiltRight = tutorialTiltRightDetected.current;
        const tiltUp = tutorialTiltUpDetected.current;
        const tiltDown = tutorialTiltDownDetected.current;
        const stepsCompleted = (tutorialSlingDetected.current ? 1 : 0) + (tiltLeft ? 1 : 0) + (tiltRight ? 1 : 0) + (tiltUp ? 1 : 0) + (tiltDown ? 1 : 0);
        const progressPercent = (stepsCompleted / 5) * 100;
        const liveX = targetXPercent;
        const liveY = targetYPercent;

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
                {/* Tutorial instruction overlay */}
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0,
                    padding: '1.5rem', textAlign: 'center', zIndex: 100,
                    pointerEvents: 'none',
                }}>
                    {/* Instruction card */}
                    <div style={{
                        background: 'var(--glass-bg)', padding: '1rem 1.25rem',
                        borderRadius: 'var(--radius-lg)', border: `1px solid ${myColor}40`,
                        backdropFilter: 'blur(20px)', boxShadow: `0 8px 30px ${myColor}20`,
                    }}>
                        {isComplete ? (
                            <><p style={{ fontSize: '1.8rem', margin: 0 }}>✅</p>
                                <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: '#fff', margin: '0.4rem 0 0.2rem' }}>All Done!</h2>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>Waiting for others...</p></>
                        ) : isSlingPhase ? (
                            <><p style={{ fontSize: '1.8rem', margin: 0, animation: 'pulse 1.5s ease-in-out infinite' }}>🏹</p>
                                <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: '#fff', margin: '0.4rem 0 0.2rem' }}>Pull the Slingshot!</h2>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>Drag down hard · hold it pulled</p></>
                        ) : (
                            <><p style={{ fontSize: '1.8rem', margin: 0, animation: 'pulse 1.5s ease-in-out infinite' }}>📱</p>
                                <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: '#fff', margin: '0.4rem 0 0.2rem' }}>Tilt All 4 Directions!</h2>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>Keep sling held · tilt ⬅️ ➡️ ⬆️ ⬇️</p></>
                        )}
                    </div>

                    {/* 4-direction tilt guide with live crosshair — shown during tilt phase */}
                    {isTiltPhase && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '0.75rem', gap: '0' }}>
                            {/* Up arrow */}
                            <span style={{ fontSize: '1.4rem', opacity: tiltUp ? 1 : 0.3, filter: tiltUp ? `drop-shadow(0 0 6px ${myColor})` : 'none', transition: 'all 0.3s', lineHeight: 1.2 }}>⬆️</span>
                            {/* Middle row: Left + crosshair circle + Right */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span style={{ fontSize: '1.4rem', opacity: tiltLeft ? 1 : 0.3, filter: tiltLeft ? `drop-shadow(0 0 6px ${myColor})` : 'none', transition: 'all 0.3s' }}>⬅️</span>
                                {/* Live crosshair mini-display */}
                                <div style={{ width: '40px', height: '40px', borderRadius: '50%', border: `2px solid ${myColor}50`, position: 'relative', background: 'rgba(255,255,255,0.03)' }}>
                                    <div style={{
                                        width: '10px', height: '10px', borderRadius: '50%',
                                        background: myColor, boxShadow: `0 0 8px ${myColor}`,
                                        position: 'absolute',
                                        left: `${liveX}%`, top: `${liveY}%`,
                                        transform: 'translate(-50%,-50%)',
                                        transition: 'left 0.08s linear, top 0.08s linear',
                                    }} />
                                </div>
                                <span style={{ fontSize: '1.4rem', opacity: tiltRight ? 1 : 0.3, filter: tiltRight ? `drop-shadow(0 0 6px ${myColor})` : 'none', transition: 'all 0.3s' }}>➡️</span>
                            </div>
                            {/* Down arrow */}
                            <span style={{ fontSize: '1.4rem', opacity: tiltDown ? 1 : 0.3, filter: tiltDown ? `drop-shadow(0 0 6px ${myColor})` : 'none', transition: 'all 0.3s', lineHeight: 1.2 }}>⬇️</span>
                        </div>
                    )}

                    {/* Progress bar */}
                    <div style={{ width: '80%', height: '5px', margin: '0.6rem auto 0', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${progressPercent}%`, height: '100%', background: `linear-gradient(90deg, ${myColor}, #fff)`, borderRadius: '3px', transition: 'width 0.3s ease', boxShadow: `0 0 8px ${myColor}` }} />
                    </div>
                </div>

                {/* Slingshot visual — same as playing phase */}
                <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }}>
                    <circle
                        cx={slingshotCenterX} cy={slingshotCenterY}
                        r={boundaryRadius} fill="none"
                        stroke={`${myColor}40`} strokeWidth={2} strokeDasharray="8,8"
                    />
                    <image
                        href={slingCenterImg}
                        x={pullEndX - 35} y={pullEndY - 35}
                        width={70} height={70}
                        style={{
                            filter: isDragging ? `drop-shadow(0 0 20px ${myColor}80)` : 'drop-shadow(0 0 10px rgba(255, 255, 255, 0.5))',
                            transition: isDragging ? 'none' : 'all 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)',
                            cursor: 'grab',
                        }}
                    />
                </svg>

                {/* Color indicator */}
                <div style={{
                    position: 'absolute', bottom: '2rem', left: '50%', transform: 'translateX(-50%)',
                    display: 'flex', alignItems: 'center', gap: '0.5rem', zIndex: 10,
                }}>
                    <div style={{
                        width: '12px', height: '12px', borderRadius: '50%',
                        background: myColor, boxShadow: `0 0 8px ${myColor}`,
                    }} />
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        Your crosshair color
                    </span>
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
                        <p style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '0.5rem' }}>Team Score</p>
                        <p style={{ fontSize: '3.5rem', fontWeight: 900, color: '#90e0ef' }}>{finalScore}</p>
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
                    <span style={{ fontWeight: 800, color: '#fff', fontSize: '1rem', letterSpacing: '0.5px' }}>Score: {teamScore}</span>
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
                {isDragging && !gyroEnabled && (
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
