import { QUIZ_TOPICS, CROSSHAIR_COLORS, PRE_CONFIG_NAMES, PRE_CONFIG_AVATARS, QUIZ_DIFFICULTIES } from '../shared/types';
import type { LobbyState, QuizTopicId, QuizDifficulty } from '../shared/types';
import backgroundImg from '../assets/Background.svg';

interface TopicOrbData {
    id: string;
    label: string;
    emoji: string;
    x: number;
    y: number;
}

interface TopicSelection_ScreenProps {
    lobby: LobbyState | null;
    topicOrbs: TopicOrbData[];
    votedControllerIds: string[];
    playerVotes: Record<string, string>; // controllerId -> topicId
    totalVoters: number;
    timeLeft: number;
    crosshairs: Map<string, { x: number; y: number }>;
    difficulty: QuizDifficulty;
}

// Returns the orb index (0-based) that a crosshair at pos.x% is hovering over,
// given n evenly-distributed cards inside the container. Returns -1 if outside.
function getHoveredOrbIndex(posX: number, posY: number, totalOrbs: number): number {
    // Cards occupy roughly the middle 80% of the container width, y between 10%–90%
    if (posY < 10 || posY > 90) return -1;
    const slotWidth = 80 / totalOrbs;
    const offsetX = posX - 10;
    if (offsetX < 0 || offsetX > 80) return -1;
    return Math.floor(offsetX / slotWidth);
}

export default function TopicSelection_Screen({
    lobby,
    topicOrbs,
    votedControllerIds,
    playerVotes,
    totalVoters,
    timeLeft,
    crosshairs,
    difficulty,
}: TopicSelection_ScreenProps) {
    const votesByPlayer = new Map<string, number>();
    for (const id of votedControllerIds) {
        votesByPlayer.set(id, 1);
    }

    // Build a set of orb indices currently hovered by any crosshair
    const hoveredOrbIndices = new Set<number>();
    for (const [controllerId, pos] of crosshairs.entries()) {
        // Skip crosshairs for players who already voted
        if (votedControllerIds.includes(controllerId)) continue;
        const idx = getHoveredOrbIndex(pos.x, pos.y, topicOrbs.length);
        if (idx >= 0) hoveredOrbIndices.add(idx);
    }

    return (
        <div
            className="screen-container"
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                paddingBottom: '22vh',
                height: '100vh',
                background: `url(${backgroundImg}) center/cover no-repeat`,
                padding: '2rem',
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            <header style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1.5rem 2.5rem',
                zIndex: 1000,
            }}>
                <div style={{
                    padding: '0.8rem 2rem',
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '30px',
                    backdropFilter: 'blur(10px)',
                }}>
                    <span style={{
                        fontSize: '1.2rem',
                        fontWeight: 800,
                        color: '#fff',
                        letterSpacing: '2px',
                    }}>
                        {votedControllerIds.length}/{totalVoters} Voted
                    </span>
                </div>

                {(() => {
                    const diffInfo = QUIZ_DIFFICULTIES.find(d => d.id === difficulty);
                    const accentMap: Record<string, string> = {
                        easy: '#22c55e',
                        medium: '#f59e0b',
                        hard: '#ef4444',
                    };
                    const accent = accentMap[difficulty] || '#f59e0b';
                    return (
                        <div style={{
                            padding: '0.8rem 1.5rem',
                            background: `${accent}18`,
                            border: `1px solid ${accent}44`,
                            borderRadius: '30px',
                            backdropFilter: 'blur(10px)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                        }}>
                            <span style={{ fontSize: '1rem' }}>{diffInfo?.emoji}</span>
                            <span style={{
                                fontSize: '1rem',
                                fontWeight: 800,
                                color: accent,
                                letterSpacing: '1px',
                                textTransform: 'uppercase',
                            }}>
                                {diffInfo?.label}
                            </span>
                        </div>
                    );
                })()}

                <div style={{
                    padding: '0.8rem 2rem',
                    background: 'rgba(255, 107, 53, 0.15)',
                    border: '1px solid rgba(255, 107, 53, 0.3)',
                    borderRadius: '30px',
                }}>
                    <span style={{
                        fontSize: '1.2rem',
                        fontWeight: 900,
                        color: '#ff6b35',
                        fontVariantNumeric: 'tabular-nums',
                    }}>
                        {timeLeft}s
                    </span>
                </div>
            </header>

            <h2 style={{
                fontSize: 'clamp(2rem, 4vw, 3rem)',
                fontWeight: 950,
                color: '#ffffff',
                marginBottom: '0.5rem',
                textTransform: 'uppercase',
                letterSpacing: '3px',
                zIndex: 10,
            }}>
                Vote for the Topic
            </h2>

            <p style={{
                fontSize: 'clamp(0.75rem, 1.2vw, 0.9rem)',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.45)',
                marginBottom: '1.5rem',
                letterSpacing: '1px',
                zIndex: 10,
                textAlign: 'center',
            }}>
                Leader can set difficulty on their controller
            </p>

            <div style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
            }}>
                <div style={{
                    display: 'flex',
                    flexDirection: 'row',
                    gap: '1.25rem',
                    padding: '2rem',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '28px',
                    backdropFilter: 'blur(10px)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                }}>
                    {topicOrbs.map((orb, i) => (
                        <div
                            key={orb.id}
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '1rem',
                                width: '180px',
                                height: '260px',
                                flexShrink: 0,
                                background: 'rgba(109, 40, 217, 0.15)',
                                borderRadius: '20px',
                                border: hoveredOrbIndices.has(i)
                                    ? '3px solid #7c3aed'
                                    : '2px solid rgba(167, 139, 250, 0.3)',
                                boxShadow: hoveredOrbIndices.has(i)
                                    ? '0 0 24px rgba(124, 58, 237, 0.7), 0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15)'
                                    : '0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15)',
                                transition: 'border 0.15s ease, box-shadow 0.15s ease',
                                cursor: 'pointer',
                            }}
                        >
                            <span style={{ fontSize: '3rem', lineHeight: 1 }}>{orb.emoji}</span>
                            <span style={{
                                fontSize: 'clamp(0.75rem, 1.2vw, 0.9rem)',
                                fontWeight: 700,
                                color: '#fff',
                                textShadow: '0 2px 8px rgba(0,0,0,0.5)',
                                textAlign: 'center',
                                lineHeight: 1.2,
                            }}>
                                {orb.label}
                            </span>
                        </div>
                    ))}
                </div>

                {Array.from(crosshairs.entries()).map(([controllerId, pos]) => {
                    // Hide crosshair once player has voted
                    if (votedControllerIds.includes(controllerId)) return null;

                    const player = lobby?.players.find(p => p.id === controllerId);
                    const colorIndex = player?.colorIndex ?? 0;
                    const color = CROSSHAIR_COLORS[colorIndex];

                    return (
                        <div
                            key={controllerId}
                            style={{
                                position: 'absolute',
                                left: `${pos.x}%`,
                                top: `${pos.y}%`,
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
                                    src={`/avatars/${PRE_CONFIG_AVATARS[colorIndex]}.png`}
                                    alt={PRE_CONFIG_NAMES[colorIndex]}
                                    style={{ width: '75%', height: '75%', objectFit: 'contain', zIndex: 2 }}
                                />
                                <div style={{ position: 'absolute', width: '100%', height: '100%', zIndex: 1 }}>
                                    <div style={{
                                        position: 'absolute', left: '50%', top: '-30%', width: '1.5px', height: '160%',
                                        background: color, transform: 'translateX(-50%)', opacity: 0.9, boxShadow: `0 0 6px ${color}`,
                                    }} />
                                    <div style={{
                                        position: 'absolute', left: '-30%', top: '50%', width: '160%', height: '1.5px',
                                        background: color, transform: 'translateY(-50%)', opacity: 0.9, boxShadow: `0 0 6px ${color}`,
                                    }} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <footer style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                display: 'flex',
                background: 'rgba(8,8,16,0.95)',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                zIndex: 200,
            }}>
                {lobby?.players.map((player, i) => (
                    <div key={player.id} style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        padding: '0.5rem 0.25rem',
                        borderRight: i < (lobby.players.length - 1) ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    }}>
                        <div style={{
                            width: 'clamp(32px, 6vw, 48px)',
                            height: 'clamp(32px, 6vw, 48px)',
                            borderRadius: '50%',
                            border: `2px solid ${CROSSHAIR_COLORS[player.colorIndex ?? 0]}`,
                            background: `${CROSSHAIR_COLORS[player.colorIndex ?? 0]}15`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: '0.25rem',
                            overflow: 'hidden',
                        }}>
                            <img
                                src={`/avatars/${PRE_CONFIG_AVATARS[player.colorIndex ?? 0]}.png`}
                                alt=""
                                style={{ width: '80%', height: '80%', objectFit: 'contain' }}
                            />
                        </div>
                        <span style={{
                            fontSize: 'clamp(0.65rem, 1.2vw, 0.85rem)',
                            fontWeight: 800,
                            color: '#fff',
                            marginBottom: '0.15rem',
                        }}>
                            {PRE_CONFIG_NAMES[player.colorIndex ?? 0]}
                        </span>
                        {votedControllerIds.includes(player.id) ? (() => {
                            const votedTopicId = playerVotes[player.id];
                            const votedTopic = topicOrbs.find(o => o.id === votedTopicId);
                            return (
                                <span style={{
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                    color: '#a78bfa',
                                    textAlign: 'center',
                                    lineHeight: 1.2,
                                }}>
                                    {votedTopic ? `${votedTopic.emoji} ${votedTopic.label}` : '✓ Voted'}
                                </span>
                            );
                        })() : (
                            <span style={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                color: 'rgba(255,255,255,0.3)',
                            }}>
                                Waiting...
                            </span>
                        )}
                    </div>
                ))}
            </footer>
        </div>
    );
}