// ==========================================
// ShootQuiz Controller Page — Refactored
// Delegates lobby/loading to sub-components,
// keeps GamePlay and Winner inline
// ==========================================

import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { useParams } from 'react-router-dom';
import { GameClient } from '../transport/GameClient';
import GameLobby_Controller from '../lobby/controller/GameLobby_Controller';
import Loading_Controller from '../lobby/controller/Loading_Controller';
import WinnerScene from '../components/WinnerScene';
import type { LobbyState, PlayerRole, ScoreUpdate, QuestionPhase, PlayerSelectionPayload, RevealResultPayload, PlayerScoreEntry, QuizTopicId, QuizDifficulty, TopicVoteUpdatePayload, TopicSelectedPayload } from '../shared/types';
import { CROSSHAIR_COLORS, QUIZ_TOPICS, PRE_CONFIG_AVATARS } from '../shared/types';
import '../index.css';
import '../animations.css';
import './controller-ui.css';
import { soundManager } from '../utils/sound';
import { hexToRgba } from '../utils/color';
import TopicSelection_Controller from './TopicSelection_Controller';

type ControllerPhase = 'connecting' | 'reconnecting' | 'lobby' | 'topic-selection' | 'loading' | 'playing' | 'game-over';

const TOTAL_QUESTIONS = 10;
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

// ==========================================
// Inline sub-components
// ==========================================

interface GamePlay_ControllerProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    isDragging: boolean;
    aimAngle: number;
    pullBack: number;
    power: number;
    characterAvatar: string;
    controllerAccent: string;
    currentScore: number;
    displayQuestionNumber: number;
    isAnswerLocked: boolean;
    isAnalysisPhase: boolean;
    latestPopup: { id: string; score: number; bonus: number; colorIndex: number } | null;
    selectedOrbId: string | null;
    phaseTimeLeft: number;
    lastHit: { correct: boolean } | null;
    isTopScorer: boolean;
    handleStart: () => void;
    handleMove: (e: React.TouchEvent | React.MouseEvent) => void;
    handleEnd: () => void;
    onLeaveGame: () => void;
}

const GamePlay_Controller = memo(function GamePlay_Controller({
    containerRef,
    isDragging,
    aimAngle,
    pullBack,
    power,
    characterAvatar,
    controllerAccent,
    currentScore,
    displayQuestionNumber,
    isAnswerLocked,
    isAnalysisPhase,
    latestPopup,
    selectedOrbId,
    phaseTimeLeft,
    lastHit,
    isTopScorer,
    handleStart,
    handleMove,
    handleEnd,
    onLeaveGame,
}: GamePlay_ControllerProps) {
    const width = containerRef.current?.offsetWidth || 400;
    const height = containerRef.current?.offsetHeight || 800;
    const slingshotCenterX = width / 2;
    const slingshotCenterY = height / 2;
    const pullEndX = isDragging ? slingshotCenterX - Math.cos(aimAngle) * pullBack : slingshotCenterX;
    const pullEndY = isDragging ? slingshotCenterY - Math.sin(aimAngle) * pullBack : slingshotCenterY;
    const pullOffsetX = pullEndX - slingshotCenterX;
    const pullOffsetY = pullEndY - slingshotCenterY;

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
                    <span
                        aria-hidden="true"
                        className={`controller-score-crown ${isTopScorer ? 'controller-score-crown--visible' : ''}`}
                    >&#x1F451;</span>
                    <span>Score: {currentScore}</span>
                </div>

                <div className="controller-question-label">Q{displayQuestionNumber}/{TOTAL_QUESTIONS}</div>

                <button
                    className="controller-close-button"
                    onTouchStart={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={onLeaveGame}
                    aria-label="Leave controller"
                    type="button"
                >
                    <span className="controller-close-button__x">&times;</span>
                    Quit
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
});

interface Winner_ControllerProps {
    scores: PlayerScoreEntry[];
    role: PlayerRole;
    currentControllerId: string;
    onRestart: () => void;
    onClose: () => void;
}

function Winner_Controller({ scores, role, currentControllerId, onRestart, onClose }: Winner_ControllerProps) {
    return (
        <WinnerScene
            variant="controller"
            scores={scores}
            role={role}
            currentControllerId={currentControllerId}
            onRestart={onRestart}
            onClose={onClose}
        />
    );
}

// ==========================================
// Main component
// ==========================================

export default function ShootQuiz_Controller() {
    const { roomId, token } = useParams<{ roomId: string; token: string }>();

    // ---- Connection ----
    const [phase, setPhase] = useState<ControllerPhase>('connecting');
    const phaseRef = useRef<ControllerPhase>('connecting');
    const setPhaseSync = (p: ControllerPhase) => { phaseRef.current = p; setPhase(p); };
    const [role, setRole] = useState<PlayerRole>('member');
    const [colorIndex, setColorIndex] = useState<number>(0);
    const [lobby, setLobby] = useState<LobbyState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reconnectInfo, setReconnectInfo] = useState<{ attempt: number; max: number } | null>(null);

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

    // Unlock audio on the very first user gesture — before the WebSocket connects.
    // This is the most reliable way to satisfy iOS's AudioContext policy.
    useEffect(() => {
        const handleGesture = () => {
            soundManager.unlock().catch(() => {});
        };
        window.addEventListener('pointerdown', handleGesture, { once: true, passive: true });
        window.addEventListener('touchstart', handleGesture, { once: true, passive: true });
        return () => {
            window.removeEventListener('pointerdown', handleGesture);
            window.removeEventListener('touchstart', handleGesture);
        };
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

    // Topic selection state
    const [topicOrbs, setTopicOrbs] = useState<Array<{ id: string; label: string; emoji: string; x: number; y: number }>>([]);
    const [topicTimeLeft, setTopicTimeLeft] = useState(10);
    const [topicTotalVoters, setTopicTotalVoters] = useState(0);
    const [topicVotedControllerIds, setTopicVotedControllerIds] = useState<string[]>([]);
    const [hasVotedTopic, setHasVotedTopic] = useState(false);
    const hasVotedTopicRef = useRef(false);
    const [selectedDifficulty, setSelectedDifficulty] = useState<QuizDifficulty>('easy');
    const topicCountdownStartedRef = useRef(false);

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
    const startPosRef = useRef({ x: 0, y: 0 });
    const lastCrosshairSendRef = useRef(0);

    // ---- Dragging ref for real-time values ----
    const isDraggingRef = useRef(false);

    // Sync refs with state
    useEffect(() => {
        isDraggingRef.current = isDragging;
        startPosRef.current = startPos;
    }, [isDragging, startPos]);

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

        // ---- Auto-reconnect callbacks ----
        client.onDisconnect(() => {
            // Only show reconnecting UI if we were already in a session
            if (phaseRef.current !== 'connecting') {
                setPhaseSync('reconnecting');
                setReconnectInfo({ attempt: 0, max: 5 });
            }
        });

        client.onReconnecting((attempt, max) => {
            setReconnectInfo({ attempt, max });
        });

        client.onReconnectFailed(() => {
            setError('Connection lost. Please scan the QR code again.');
            setReconnectInfo(null);
        });

        client.connect().then(() => {
            // Unlock audio — the WebSocket connect itself isn't a user gesture,
            // but by this point the user has already tapped to open the page.
            // We also attach a one-time gesture listener as a belt-and-suspenders
            // fallback (handled in the top-level useEffect below).
            soundManager.unlock().catch(() => {});

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
                setReconnectInfo(null);
                setPhaseSync('lobby');
            });

            client.onReconnected((data) => {
                console.log('[Room] Reconnected:', data);
                if (!data.success) return;

                setRole(data.role ?? 'member');
                setColorIndex(data.colorIndex ?? 0);
                setReconnectInfo(null);

                if (data.playerScores) setPlayerScores(data.playerScores);

                // Restore current question if server sent it
                if (data.currentQuestion) {
                    // Question state is managed by onQuestion/onPhaseChange — just ensure we're in playing
                }
                if (data.phaseTimeLeft !== undefined) {
                    setPhaseTimeLeft(data.phaseTimeLeft);
                }

                const serverPhase = data.phase as string;
                if (serverPhase === 'playing') {
                    setPhaseSync('playing');
                } else if (serverPhase === 'game-over') {
                    setPhaseSync('game-over');
                } else {
                    setPhaseSync('lobby');
                }
                setIsSpectating(false);
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
                setTopicOrbs([]);
                setTopicTimeLeft(10);
                setTopicVotedControllerIds([]);
                setTopicTotalVoters(0);
                setHasVotedTopic(false);
                hasVotedTopicRef.current = false;
                setSelectedDifficulty('easy');
                if (loadingCountdownIntervalRef.current) {
                    clearInterval(loadingCountdownIntervalRef.current);
                    loadingCountdownIntervalRef.current = null;
                }
                setCountdownActive(false);
            });

            // Server-authoritative session expiry
            client.onRoomExpired(() => {
                console.log('[Controller] room:expired received, session timed out');
                setError('Session expired due to inactivity');
                scheduleTimeout(() => {
                    window.location.href = '/';
                }, 2000);
            });

            // Topic selection events
            client.onTopicVoteUpdate((data) => {
                if (data.topics && data.topics.length > 0) {
                    setTopicOrbs(data.topics);
                }
                setTopicVotedControllerIds(data.votedControllerIds);
                setTopicTotalVoters(data.totalVoters);
                if (data.difficulty) setSelectedDifficulty(data.difficulty);

                if (!topicCountdownStartedRef.current) {
                    setTopicTimeLeft(data.timeLeft);
                }

                // Auto-switch to topic-selection phase
                if (phaseRef.current === 'lobby') {
                    setPhaseSync('topic-selection');
                }
            });

            client.onTopicSelected((_data: TopicSelectedPayload) => {
                console.log('[Controller] Topic selected, transitioning to loading');
                setPhaseSync('loading');
                setHasVotedTopic(false);
                hasVotedTopicRef.current = false;
            });
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

    // ---- Topic selection countdown timer ----
    useEffect(() => {
        if (phase !== 'topic-selection') {
            topicCountdownStartedRef.current = false;
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
    }, [phase, topicTimeLeft]);

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

        // iOS/Android Audio Unlock — must happen on a user gesture
        soundManager.unlock().catch(() => {});

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

        const dx = startPosRef.current.x - x;
        const dy = startPosRef.current.y - y;
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
            // Throttle crosshair updates to ~20fps (50ms interval)
            const now = Date.now();
            if (now - lastCrosshairSendRef.current > 50) {
                clientRef.current?.sendCrosshair(tX, tY);
                lastCrosshairSendRef.current = now;
            }
        }
    }, [isDragging, startPos, phase]);

    const handleEnd = useCallback(() => {
        if (!isDragging) return;

        // During topic-selection, the TopicSelection_Controller has its own touch handlers
        if (phase === 'topic-selection') {
            setIsDragging(false);
            setPullBack(0);
            setPower(0);
            return;
        }

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
    }, [isDragging, power, targetXPercent, targetYPercent, phase]);

    // ==========================================
    // PHASE ROUTING
    // ==========================================

    const activeColorIndex = lobby?.players.find((p) => p.id === clientIdRef.current)?.colorIndex ?? colorIndex;

    if (error) {
        return (
            <div className="controller-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <h2 style={{ color: 'var(--accent-error)', fontSize: '1.5rem', fontWeight: 900 }}>&#x274C; {error}</h2>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>Try scanning the QR code again.</p>
                </div>
            </div>
        );
    }

    if (phase === 'connecting') {
        return (
            <div className="controller-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <div className="pulse-ring" />
                <h2 className="waiting-title" style={{ marginTop: '1rem' }}>Connecting...</h2>
            </div>
        );
    }

    if (phase === 'reconnecting') {
        return (
            <div className="controller-container" style={{
                justifyContent: 'center',
                alignItems: 'center',
                flexDirection: 'column',
                gap: '1rem',
                background: 'linear-gradient(180deg, #0f0f1a 0%, #1a1a2e 100%)',
            }}>
                <div className="pulse-ring" />
                <h2 className="waiting-title" style={{ marginTop: '1rem', color: '#f59e0b' }}>
                    Reconnecting...
                </h2>
                {reconnectInfo && (
                    <p style={{
                        color: 'rgba(255,255,255,0.5)',
                        fontSize: '0.9rem',
                        fontWeight: 600,
                    }}>
                        Attempt {reconnectInfo.attempt} of {reconnectInfo.max}
                    </p>
                )}
                <p style={{
                    color: 'rgba(255,255,255,0.35)',
                    fontSize: '0.8rem',
                    textAlign: 'center',
                    maxWidth: '260px',
                }}>
                    Your session is being restored. Please wait.
                </p>
            </div>
        );
    }

    if (phase === 'lobby') {
        return (
            <GameLobby_Controller
                role={role}
                colorIndex={lobby?.players.find((p) => p.id === clientIdRef.current)?.colorIndex ?? colorIndex}
                lobby={lobby}
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

    if (phase === 'loading') {
        return (
            <Loading_Controller
                colorIndex={activeColorIndex}
                countdownActive={countdownActive}
                countdownValue={countdownValue}
            />
        );
    }

    if (phase === 'topic-selection') {
        return (
            <TopicSelection_Controller
                role={role}
                colorIndex={activeColorIndex}
                topicOrbs={topicOrbs}
                timeLeft={topicTimeLeft}
                totalVoters={topicTotalVoters}
                votedControllerIds={topicVotedControllerIds}
                hasVoted={hasVotedTopic}
                onVote={(topicId: QuizTopicId) => {
                    if (hasVotedTopicRef.current) return;
                    setHasVotedTopic(true);
                    hasVotedTopicRef.current = true;
                    clientRef.current?.sendTopicVote(topicId);
                }}
                selectedDifficulty={selectedDifficulty}
                onDifficultyChange={(difficulty: QuizDifficulty) => {
                    setSelectedDifficulty(difficulty);
                    clientRef.current?.sendSetDifficulty(difficulty);
                }}
                sendCrosshair={(x, y) => clientRef.current?.sendCrosshair(x, y)}
                sendCancelAiming={() => clientRef.current?.sendCancelAiming()}
                sendStartAiming={() => clientRef.current?.sendStartAiming()}
            />
        );
    }

    if (phase === 'game-over') {
        return (
            <Winner_Controller
                scores={playerScores}
                role={role}
                currentControllerId={clientIdRef.current}
                onRestart={() => clientRef.current?.restartGame()}
                onClose={() => {
                    if (role === 'leader') {
                        clientRef.current?.restartGame();
                    } else {
                        clientRef.current?.sendLeaveGame();
                    }
                    clientRef.current?.close();
                    window.location.href = '/';
                }}
            />
        );
    }

    // phase === 'playing'
    const characterAvatar = PRE_CONFIG_AVATARS[activeColorIndex] || 'wulf';
    const controllerAccent = CROSSHAIR_COLORS[activeColorIndex] || CROSSHAIR_COLORS[0];
    const currentScore = playerScores.find((p) => p.controllerId === clientIdRef.current)?.score ?? 0;
    const latestPopup = scorePopups[scorePopups.length - 1] ?? null;
    const displayQuestionNumber = Math.max(1, questionNumber || 1);
    const isAnswerLocked = isMultiplayer && hasSelectedThisRound && currentPhase === 'selection';
    const isAnalysisPhase = isMultiplayer && currentPhase === 'analysis' && phase === 'playing';

    // Crown logic: only the top scorer in the room gets the crown.
    // In singleplayer (no other scores), the crown is never shown (no competition).
    const topScore = playerScores.length > 0 ? Math.max(...playerScores.map(p => p.score)) : 0;
    const isTopScorer = playerScores.length > 1 && currentScore > 0 && currentScore === topScore;

    return (
        <GamePlay_Controller
            containerRef={containerRef}
            isDragging={isDragging}
            aimAngle={aimAngle}
            pullBack={pullBack}
            power={power}
            characterAvatar={characterAvatar}
            controllerAccent={controllerAccent}
            currentScore={currentScore}
            displayQuestionNumber={displayQuestionNumber}
            isAnswerLocked={isAnswerLocked}
            isAnalysisPhase={isAnalysisPhase}
            latestPopup={latestPopup}
            selectedOrbId={selectedOrbId}
            phaseTimeLeft={phaseTimeLeft}
            lastHit={lastHit}
            isTopScorer={isTopScorer}
            handleStart={handleStart}
            handleMove={handleMove}
            handleEnd={handleEnd}
            onLeaveGame={() => {
                clientRef.current?.sendLeaveGame();
                setIsSpectating(true);
                setPhaseSync('lobby');
            }}
        />
    );
}