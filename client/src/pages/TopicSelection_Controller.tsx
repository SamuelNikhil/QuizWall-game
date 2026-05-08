import { useEffect, useState, useRef, useCallback } from 'react';
import { QUIZ_TOPICS, CROSSHAIR_COLORS, PRE_CONFIG_AVATARS, QUIZ_DIFFICULTIES } from '../shared/types';
import type { QuizTopicId, QuizDifficulty, PlayerRole } from '../shared/types';
import { hexToRgba } from '../utils/color';
import '../index.css';
import '../animations.css';
import './controller-ui.css';

interface TopicOrbData {
    id: string;
    label: string;
    emoji: string;
    x: number;
    y: number;
}

interface TopicSelection_ControllerProps {
    role: PlayerRole;
    colorIndex: number;
    topicOrbs: TopicOrbData[];
    timeLeft: number;
    totalVoters: number;
    votedControllerIds: string[];
    hasVoted: boolean;
    onVote: (topicId: QuizTopicId) => void;
    selectedDifficulty: QuizDifficulty;
    onDifficultyChange: (difficulty: QuizDifficulty) => void;
    sendCrosshair: (x: number, y: number) => void;
    sendCancelAiming: () => void;
    sendStartAiming: () => void;
}

const TOPIC_HIT_RADIUS = 25;

function detectTopicHit(xPercent: number, yPercent: number, orbs: TopicOrbData[]): string | null {
    let closestOrb: string | null = null;
    let closestDist = Infinity;

    for (const orb of orbs) {
        const dist = Math.sqrt(Math.pow(xPercent - orb.x, 2) + Math.pow(yPercent - orb.y, 2));
        if (dist < TOPIC_HIT_RADIUS && dist < closestDist) {
            closestOrb = orb.id;
            closestDist = dist;
        }
    }
    return closestOrb;
}

export default function TopicSelection_Controller({
    role,
    colorIndex,
    topicOrbs,
    timeLeft,
    totalVoters,
    votedControllerIds,
    hasVoted,
    onVote,
    selectedDifficulty,
    onDifficultyChange,
    sendCrosshair,
    sendCancelAiming,
    sendStartAiming,
}: TopicSelection_ControllerProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [pullBack, setPullBack] = useState(0);
    const [power, setPower] = useState(0);
    const [aimAngle, setAimAngle] = useState(0);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const [targetXPercent, setTargetXPercent] = useState(50);
    const [targetYPercent, setTargetYPercent] = useState(50);
    const [hitTopicId, setHitTopicId] = useState<string | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const startPosRef = useRef({ x: 0, y: 0 });
    const lastCrosshairSendRef = useRef(0);
    const isDraggingRef = useRef(false);
    const hasVotedRef = useRef(false);
    const powerRef = useRef(0);
    const targetXPercentRef = useRef(50);
    const targetYPercentRef = useRef(50);

    useEffect(() => {
        hasVotedRef.current = hasVoted;
    }, [hasVoted]);

    useEffect(() => {
        if (topicOrbs.length > 0) {
            const hit = detectTopicHit(targetXPercent, targetYPercent, topicOrbs);
            setHitTopicId(hit);
        }
    }, [targetXPercent, targetYPercent, topicOrbs]);

    const handleStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        e.preventDefault();
        if (hasVotedRef.current) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        isDraggingRef.current = true;
        setIsDragging(true);
        setStartPos({ x: rect.width / 2, y: rect.height / 2 });
        startPosRef.current = { x: rect.width / 2, y: rect.height / 2 };
        setPullBack(0);
        setPower(0);
        powerRef.current = 0;

        sendStartAiming();
    }, [sendStartAiming]);

    const handleMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        if (!isDraggingRef.current || hasVotedRef.current) return;

        const touch = 'touches' in e ? e.touches[0] : e;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        const dx = startPosRef.current.x - x;
        const dy = startPosRef.current.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxPull = 100;
        const clampedDist = Math.min(dist, maxPull);
        const angle = Math.atan2(dy, dx);

        setPullBack(clampedDist);
        const newPower = Math.min(100, (clampedDist / maxPull) * 100);
        setPower(newPower);
        powerRef.current = newPower;
        setAimAngle(angle);

        const tX = Math.max(0, Math.min(100, 50 - (dx / maxPull) * 50));
        const tY = Math.max(0, Math.min(100, 50 - (dy / maxPull) * 50));
        setTargetXPercent(tX);
        setTargetYPercent(tY);
        targetXPercentRef.current = tX;
        targetYPercentRef.current = tY;

        const now = Date.now();
        if (now - lastCrosshairSendRef.current > 50) {
            sendCrosshair(tX, tY);
            lastCrosshairSendRef.current = now;
        }
    }, [sendCrosshair]);

    const handleEnd = useCallback(() => {
        if (!isDraggingRef.current) return;

        const currentPower = powerRef.current;
        const currentTX = targetXPercentRef.current;
        const currentTY = targetYPercentRef.current;

        if (currentPower > 10 && !hasVotedRef.current) {
            const hitId = detectTopicHit(currentTX, currentTY, topicOrbs);
            if (hitId) {
                onVote(hitId as QuizTopicId);
                setHitTopicId(hitId);
            }
        }

        isDraggingRef.current = false;
        setIsDragging(false);
        setPullBack(0);
        setPower(0);
        powerRef.current = 0;

        sendCancelAiming();
    }, [topicOrbs, onVote, sendCancelAiming]);

    const controllerAccent = CROSSHAIR_COLORS[colorIndex] || CROSSHAIR_COLORS[0];
    const characterAvatar = PRE_CONFIG_AVATARS[colorIndex] || 'wulf';

    const width = containerRef.current?.offsetWidth || 400;
    const height = containerRef.current?.offsetHeight || 800;
    const slingshotCenterX = width / 2;
    const slingshotCenterY = height / 2;
    const pullEndX = isDragging ? slingshotCenterX - Math.cos(aimAngle) * pullBack : slingshotCenterX;
    const pullEndY = isDragging ? slingshotCenterY - Math.sin(aimAngle) * pullBack : slingshotCenterY;
    const pullOffsetX = pullEndX - slingshotCenterX;
    const pullOffsetY = pullEndY - slingshotCenterY;

    const controllerTone = hasVoted ? 'locked' : isDragging ? 'aiming' : 'default';

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

            <header className="controller-shell__topbar">
                <div className="controller-score-label">
                    <span>{votedControllerIds.length}/{totalVoters}</span>
                </div>
                <div className="controller-question-label" style={{ color: timeLeft <= 3 ? '#ff4444' : undefined }}>
                    {timeLeft}s
                </div>
                <div style={{ width: '48px' }} />
            </header>

            <div className="controller-shell__center">
                {!hasVoted && !isDragging && (
                    <p className="controller-release-copy">Shoot a Topic!</p>
                )}
                {!hasVoted && isDragging && (
                    <p className="controller-release-copy">Release to Vote</p>
                )}
                {hasVoted && (
                    <p className="controller-release-copy" style={{ color: '#10b981' }}>Vote Sent!</p>
                )}

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
                {isDragging && !hasVoted && (
                    <div className="controller-bottom-score controller-bottom-score--power">
                        {Math.max(0, Math.round(power))}
                    </div>
                )}

                {hasVoted && (
                    <div className="controller-lock-pill">
                        <span className="controller-lock-pill__title">Vote Locked</span>
                        <span className="controller-lock-pill__meta">
                            {hitTopicId ? QUIZ_TOPICS.find(t => t.id === hitTopicId)?.label || '?' : '?'}
                        </span>
                    </div>
                )}

                {!hasVoted && !isDragging && role === 'leader' && (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.5rem',
                        width: '100%',
                        padding: '0 1.5rem',
                    }}>
                        <span style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            letterSpacing: '2px',
                            textTransform: 'uppercase',
                            color: 'rgba(255,255,255,0.4)',
                        }}>
                            Difficulty
                        </span>
                        <div style={{
                            display: 'flex',
                            gap: '0.5rem',
                            width: '100%',
                        }}>
                            {QUIZ_DIFFICULTIES.map((d) => {
                                const isSelected = selectedDifficulty === d.id;
                                const accentMap: Record<string, string> = {
                                    easy: '#22c55e',
                                    medium: '#f59e0b',
                                    hard: '#ef4444',
                                };
                                const accent = accentMap[d.id];
                                return (
                                    <button
                                        key={d.id}
                                        onPointerDown={(e) => {
                                            e.stopPropagation();
                                            onDifficultyChange(d.id);
                                        }}
                                        style={{
                                            flex: 1,
                                            padding: '0.55rem 0',
                                            borderRadius: '12px',
                                            border: isSelected
                                                ? `2px solid ${accent}`
                                                : '2px solid rgba(255,255,255,0.1)',
                                            background: isSelected
                                                ? `${accent}22`
                                                : 'rgba(255,255,255,0.04)',
                                            color: isSelected ? accent : 'rgba(255,255,255,0.4)',
                                            fontSize: '0.75rem',
                                            fontWeight: 800,
                                            letterSpacing: '0.5px',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                            touchAction: 'none',
                                        }}
                                    >
                                        {d.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {!hasVoted && !isDragging && role !== 'leader' && (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.25rem',
                    }}>
                        <div className="controller-bottom-hint">DRAG TO AIM</div>
                        <span style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            color: 'rgba(255,255,255,0.3)',
                            letterSpacing: '1px',
                        }}>
                            {QUIZ_DIFFICULTIES.find(d => d.id === selectedDifficulty)?.emoji}{' '}
                            {QUIZ_DIFFICULTIES.find(d => d.id === selectedDifficulty)?.label}
                        </span>
                    </div>
                )}

                {!hasVoted && isDragging && (
                    <div className="controller-bottom-hint">DRAG TO AIM</div>
                )}
            </div>
        </div>
    );
}