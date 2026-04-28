import { useEffect, useState } from 'react';
import type { PlayerRole, PlayerScoreEntry } from '../shared/types';
import { CROSSHAIR_COLORS } from '../shared/types';
import './winner-ui.css';

const CHARACTER_NAMES = ['Wulf', 'Talon', 'Ryker', 'Zark'] as const;
const CHARACTER_AVATARS = ['wulf', 'talon', 'ryker', 'zark'] as const;
const CONTROLLER_CONFETTI = [
    { left: '6%', top: '7%', width: '0.95rem', height: '1.7rem', rotate: '-18deg', delay: '0s' },
    { left: '14%', top: '4%', width: '0.4rem', height: '0.4rem', rotate: '22deg', delay: '0.08s' },
    { left: '21%', top: '10%', width: '0.5rem', height: '0.5rem', rotate: '-36deg', delay: '0.12s' },
    { left: '74%', top: '5%', width: '0.6rem', height: '0.6rem', rotate: '12deg', delay: '0.05s' },
    { left: '84%', top: '8%', width: '0.7rem', height: '1.5rem', rotate: '14deg', delay: '0.14s' },
    { left: '90%', top: '3%', width: '0.35rem', height: '0.35rem', rotate: '-22deg', delay: '0.18s' },
] as const;

interface WinnerSceneProps {
    variant: 'screen' | 'controller';
    scores: PlayerScoreEntry[];
    role?: PlayerRole;
    currentControllerId?: string;
    onRestart?: () => void;
    onClose?: () => void;
}

function getCharacterAvatar(colorIndex: number): string {
    return CHARACTER_AVATARS[colorIndex] || CHARACTER_AVATARS[0];
}

function getCharacterName(entry?: PlayerScoreEntry | null): string {
    if (!entry) return 'Winner';
    return CHARACTER_NAMES[entry.colorIndex] || entry.name || 'Winner';
}

export default function WinnerScene({
    variant,
    scores,
    role,
    currentControllerId,
    onRestart,
    onClose,
}: WinnerSceneProps) {
    const [revealed, setRevealed] = useState(false);
    const [isRestarting, setIsRestarting] = useState(false);

    useEffect(() => {
        const timerId = window.setTimeout(() => setRevealed(true), 420);
        return () => window.clearTimeout(timerId);
    }, []);

    const handleRestart = () => {
        if (role !== 'leader' || isRestarting) return;
        setIsRestarting(true);
        onRestart?.();
    };

    const sortedScores = [...scores].sort((a, b) => b.score - a.score);
    const winner = sortedScores[0] ?? null;

    const winnerName = winner ? getCharacterName(winner) : 'No Winner';
    const winnerAvatar = winner ? getCharacterAvatar(winner.colorIndex) : getCharacterAvatar(0);
    const rootClassName = [
        variant === 'screen' ? 'screen-container' : 'controller-container',
        'winner-scene',
        `winner-scene--${variant}`,
        revealed ? 'is-revealed' : '',
    ].filter(Boolean).join(' ');

    return (
        <div className={rootClassName}>
            <div className="winner-scene__backdrop" />
            <div className="winner-scene__glow" />

            {variant === 'controller' && (
                <div className="winner-scene__confetti" aria-hidden="true">
                    {CONTROLLER_CONFETTI.map((piece, index) => (
                        <span
                            key={`${piece.left}-${index}`}
                            className="winner-scene__confetti-piece"
                            style={{
                                left: piece.left,
                                top: piece.top,
                                width: piece.width,
                                height: piece.height,
                                transform: `rotate(${piece.rotate})`,
                                animationDelay: piece.delay,
                            }}
                        />
                    ))}
                </div>
            )}

            {variant === 'controller' && onClose && (
                <button
                    className="controller-close-button winner-controller__close"
                    type="button"
                    aria-label="Close winner screen"
                    onClick={onClose}
                >
                    &times;
                </button>
            )}

            <section className="winner-summary">
                <div className="winner-summary__title">{winner ? 'WINNER' : 'GAME OVER'}</div>
                <div className="winner-summary__score">{winner ? winner.score.toLocaleString() + ' pts' : '—'}</div>

                <div className="winner-avatar-card">
                    <div className="winner-avatar-card__ring">
                        <img
                            src={`/avatars/${winnerAvatar}.png`}
                            alt={winnerName}
                            className="winner-avatar-card__image"
                            draggable={false}
                        />
                    </div>
                    <div className="winner-avatar-card__name">{winnerName}</div>
                </div>
            </section>

            <section className="winner-board" aria-hidden={!revealed}>
                <div className="winner-board__rows">
                    {sortedScores.map((player, index) => {
                        const accent = CROSSHAIR_COLORS[player.colorIndex] || CROSSHAIR_COLORS[0];
                        const isSelf = player.controllerId === currentControllerId;
                        const rowClassName = [
                            'winner-board__row',
                            index === 0 ? 'is-winner' : '',
                            isSelf ? 'is-self' : '',
                        ].filter(Boolean).join(' ');

                        return (
                            <div key={player.controllerId} className={rowClassName}>
                                <div className="winner-board__player">
                                    <span
                                        className="winner-board__dot"
                                        style={{
                                            background: accent,
                                            boxShadow: `0 0 18px ${accent}44`,
                                        }}
                                    />
                                    <span className="winner-board__name" style={{ color: accent }}>
                                        {getCharacterName(player)}
                                    </span>
                                </div>
                                <span className="winner-board__points" style={{ color: accent }}>
                                    {player.score.toLocaleString()}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {variant === 'screen' && (
                    <p className="winner-screen__note">
                        Host can <span>restart</span> the game by tapping restart button from mobile
                    </p>
                )}
            </section>

            {variant === 'controller' && (
                <footer className="winner-controller__dock">
                    <p className="winner-controller__hint">
                        {role === 'leader'
                            ? 'Start a fresh round from this controller.'
                            : 'Only the host can restart the game.'}
                    </p>
                    <button
                        type="button"
                        className="winner-controller__restart"
                        onClick={handleRestart}
                        disabled={role !== 'leader' || isRestarting}
                    >
                        {role === 'leader' ? (
                            isRestarting ? (
                                <span className="winner-controller__spinner" aria-label="Loading" />
                            ) : (
                                'Restart'
                            )
                        ) : (
                            'Waiting for host'
                        )}
                    </button>
                </footer>
            )}
        </div>
    );
}
