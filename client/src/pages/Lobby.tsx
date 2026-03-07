// ==========================================
// Lobby Page — Presentation Layer
// Leader: enters team name + Start Game button
// Member: I'm Ready button
// ==========================================

import { useState, useEffect, useRef } from 'react';
import type { LobbyState, PlayerRole } from '../shared/types';
import { CROSSHAIR_COLORS } from '../shared/types';
import '../index.css';

interface LobbyProps {
    role: PlayerRole;
    lobby: LobbyState | null;
    colorIndex: number;
    onSetTeamName: (name: string) => void;
    onSetPlayerName: (name: string) => void;
    onReady: () => void;
    onStartGame: () => void;
    onLeave: () => void;
}

// Reusable close button matching gameplay/game-over style
const LeaveButton = ({ onLeave }: { onLeave: () => void }) => (
    <button
        onClick={onLeave}
        style={{
            position: 'absolute', top: '1rem', right: '1rem', zIndex: 10,
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
);

export default function Lobby({
    role,
    lobby,
    onSetTeamName,
    onSetPlayerName,
    onReady,
    onStartGame,
    onLeave,
}: LobbyProps) {
    const [teamName, setTeamName] = useState('');
    const [nameSubmitted, setNameSubmitted] = useState(false);
    const [isReady, setIsReady] = useState(false);
    
    // Persist player name in sessionStorage so it survives game restarts
    const savedPlayerName = sessionStorage.getItem('slingshot_player_name') || '';
    const [playerName, setPlayerName] = useState(savedPlayerName);
    const [playerNameSubmitted, setPlayerNameSubmitted] = useState(savedPlayerName.length >= 2);
    const [isFadingOut, setIsFadingOut] = useState(false);
    const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (fadeTimeoutRef.current) {
                clearTimeout(fadeTimeoutRef.current);
            }
        };
    }, []);

    // Auto-submit saved player name on mount (for game restarts)
    useEffect(() => {
        if (savedPlayerName.length >= 2 && !playerNameSubmitted) {
            onSetPlayerName(savedPlayerName);
            setPlayerNameSubmitted(true);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSubmitPlayerName = () => {
        const trimmed = playerName.trim();
        if (trimmed.length < 2) return;
        
        // Save to sessionStorage for persistence across game restarts
        sessionStorage.setItem('slingshot_player_name', trimmed);
        
        // Start fade out animation
        setIsFadingOut(true);
        
        // After animation, submit and hide
        fadeTimeoutRef.current = setTimeout(() => {
            onSetPlayerName(trimmed);
            setPlayerNameSubmitted(true);
            setIsFadingOut(false);
        }, 300); // Match animation duration
    };

    const handleSubmitName = () => {
        const trimmed = teamName.trim();
        if (trimmed.length < 2) return;
        onSetTeamName(trimmed);
        setNameSubmitted(true);
    };

    const handleReady = () => {
        // Submit player name before readying up
        if (playerName.trim().length >= 2 && !playerNameSubmitted) {
            const trimmed = playerName.trim();
            sessionStorage.setItem('slingshot_player_name', trimmed);
            onSetPlayerName(trimmed);
            setPlayerNameSubmitted(true);
        }
        setIsReady(true);
        onReady();
    };

    // If local nameSubmitted is false but the lobby already has a team name 
    // (e.g. on re-join/refresh), we should skip the entry dialog.
    const effectiveNameSubmitted = nameSubmitted || (lobby?.team.name && lobby.team.name.length >= 2);

    // ---- Leader: Team Name Dialog ----
    if (role === 'leader' && !effectiveNameSubmitted) {
        return (
            <div className="controller-container" style={{ justifyContent: 'center', alignItems: 'center', padding: '2rem', position: 'relative' }}>
                <LeaveButton onLeave={onLeave} />
                <div
                    style={{
                        maxWidth: '360px',
                        width: '100%',
                        background: 'var(--glass-bg)',
                        padding: '3rem 2rem',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--glass-border)',
                        backdropFilter: 'blur(20px)',
                        boxShadow: 'var(--glass-glow)',
                        animation: 'bounceIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        textAlign: 'center',
                    }}
                >
                    <div
                        style={{
                            width: '80px',
                            height: '80px',
                            margin: '0 auto 1.5rem',
                            background: 'var(--accent-primary)',
                            borderRadius: '35%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '2.5rem',
                            boxShadow: '0 10px 30px rgba(103, 80, 164, 0.4)',
                        }}
                    >
                        👑
                    </div>

                    <h2
                        style={{
                            fontSize: '1.75rem',
                            fontWeight: 900,
                            marginBottom: '0.5rem',
                            color: '#fff',
                            fontFamily: 'var(--font-main)',
                        }}
                    >
                        You're the Leader!
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', fontWeight: 500 }}>
                        Name your team to begin
                    </p>

                    <input
                        type="text"
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSubmitName()}
                        placeholder="Enter team name..."
                        maxLength={20}
                        style={{
                            width: '100%',
                            padding: '1rem 1.25rem',
                            fontSize: '1.1rem',
                            fontWeight: 700,
                            background: 'rgba(255,255,255,0.06)',
                            border: '2px solid var(--glass-border)',
                            borderRadius: 'var(--radius-md)',
                            color: '#fff',
                            outline: 'none',
                            textAlign: 'center',
                            fontFamily: 'var(--font-main)',
                            marginBottom: '1.5rem',
                        }}
                    />

                    <button
                        onClick={handleSubmitName}
                        disabled={teamName.trim().length < 2}
                        style={{
                            width: '100%',
                            padding: '1.1rem 2rem',
                            fontSize: '1.2rem',
                            fontWeight: 800,
                            background: teamName.trim().length >= 2 ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            color: 'white',
                            cursor: teamName.trim().length >= 2 ? 'pointer' : 'not-allowed',
                            boxShadow: teamName.trim().length >= 2 ? '0 8px 25px rgba(103, 80, 164, 0.5)' : 'none',
                            transition: 'all 0.3s ease',
                        }}
                    >
                        ✓ Set Team Name
                    </button>
                </div>
            </div>
        );
    }

    // ---- Leader: Lobby (waiting for members to ready up) ----
    if (role === 'leader') {
        const memberCount = (lobby?.team.members.length ?? 1) - 1; // exclude leader
        const allReady = lobby?.canStart ?? false;

        return (
            <div className="controller-container" style={{ justifyContent: 'center', alignItems: 'center', padding: '2rem', position: 'relative' }}>
                <LeaveButton onLeave={onLeave} />
                <div
                    style={{
                        maxWidth: '380px',
                        width: '100%',
                        background: 'var(--glass-bg)',
                        padding: '2.5rem 2rem',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--glass-border)',
                        backdropFilter: 'blur(20px)',
                        boxShadow: 'var(--glass-glow)',
                        animation: 'bounceIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        textAlign: 'center',
                    }}
                >
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#fff', marginBottom: '0.25rem' }}>
                        {lobby?.team.name || 'Team'}
                    </h2>
                    <p style={{ color: 'var(--accent-secondary)', fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem' }}>
                        👑 You are the Leader
                    </p>

                    {/* Leader player name input */}
                    {!playerNameSubmitted ? (
                        <div style={{
                            marginBottom: '1.5rem',
                            padding: '1rem',
                            background: 'rgba(139, 92, 246, 0.08)',
                            borderRadius: 'var(--radius-md)',
                            border: '2px solid rgba(139, 92, 246, 0.5)',
                            boxShadow: '0 0 20px rgba(139, 92, 246, 0.3)',
                            animation: isFadingOut ? 'fadeOut 0.3s ease-out forwards' : 'fadeIn 0.3s ease-out',
                        }}>
                            <p style={{ color: '#a78bfa', fontSize: '0.9rem', marginBottom: '0.75rem', fontWeight: 700, animation: 'pulse 2s infinite' }}>
                                ⚡ Enter your name to continue
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <input
                                    type="text"
                                    value={playerName}
                                    onChange={(e) => setPlayerName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSubmitPlayerName()}
                                    placeholder="Enter your name..."
                                    maxLength={20}
                                    autoFocus
                                    style={{
                                        flex: 1,
                                        padding: '0.65rem 0.8rem',
                                        fontSize: '0.9rem',
                                        fontWeight: 700,
                                        background: 'rgba(255,255,255,0.06)',
                                        border: '2px solid rgba(139, 92, 246, 0.6)',
                                        borderRadius: 'var(--radius-sm)',
                                        color: '#fff',
                                        outline: 'none',
                                        textAlign: 'center',
                                        fontFamily: 'var(--font-main)',
                                    }}
                                />
                                <button
                                    onClick={handleSubmitPlayerName}
                                    disabled={playerName.trim().length < 2 || isFadingOut}
                                    style={{
                                        padding: '0.65rem 1rem',
                                        fontSize: '0.85rem',
                                        fontWeight: 800,
                                        background: playerName.trim().length >= 2 ? 'var(--accent-success)' : 'rgba(255,255,255,0.1)',
                                        border: 'none',
                                        borderRadius: 'var(--radius-sm)',
                                        color: 'white',
                                        cursor: playerName.trim().length >= 2 && !isFadingOut ? 'pointer' : 'not-allowed',
                                    }}
                                >✓</button>
                            </div>
                        </div>
                    ) : null}

                    {/* Members list */}
                    <div style={{ marginBottom: '2rem' }}>
                        {lobby?.team.members.map((m) => (
                            <div
                                key={m.id}
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '0.75rem 1rem',
                                    marginBottom: '0.5rem',
                                    background: 'rgba(255,255,255,0.05)',
                                    borderRadius: 'var(--radius-sm)',
                                    border: `1px solid ${m.isReady ? 'rgba(16,185,129,0.3)' : 'var(--glass-border)'}`,
                                }}
                            >
                                <span style={{ fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {m.role === 'leader' ? '👑' : '🎮'} {m.name || (m.role === 'leader' ? 'Leader' : 'Player')} {m.role === 'leader' ? '(You)' : ''}
                                    <span
                                        style={{
                                            width: '10px',
                                            height: '10px',
                                            borderRadius: '50%',
                                            background: CROSSHAIR_COLORS[m.colorIndex ?? 0] || CROSSHAIR_COLORS[0],
                                            boxShadow: `0 0 6px ${CROSSHAIR_COLORS[m.colorIndex ?? 0] || CROSSHAIR_COLORS[0]}`,
                                        }}
                                        title="Crosshair color"
                                    />
                                </span>
                                <span
                                    style={{
                                        color: m.isReady ? 'var(--accent-success)' : 'var(--text-secondary)',
                                        fontWeight: 700,
                                        fontSize: '0.85rem',
                                    }}
                                >
                                    {m.isReady ? '✓ Ready' : '⏳ Waiting'}
                                </span>
                            </div>
                        ))}
                    </div>

                    {memberCount === 0 && (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem', fontStyle: 'italic' }}>
                            Share the QR code for teammates to join!
                        </p>
                    )}

                    {/* Show name confirmation after submission */}
                    {playerNameSubmitted && (
                        <p style={{ color: 'var(--accent-success)', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 600 }}>
                            ✓ Playing as "{playerName.trim()}"
                        </p>
                    )}

                    <button
                        onClick={onStartGame}
                        disabled={!allReady || !playerNameSubmitted}
                        style={{
                            width: '100%',
                            padding: '1.25rem 2rem',
                            fontSize: '1.3rem',
                            fontWeight: 900,
                            background: allReady && playerNameSubmitted ? 'var(--accent-primary)' : 'rgba(255,255,255,0.08)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            color: allReady && playerNameSubmitted ? 'white' : 'var(--text-secondary)',
                            cursor: allReady && playerNameSubmitted ? 'pointer' : 'not-allowed',
                            boxShadow: allReady && playerNameSubmitted ? '0 8px 25px rgba(103, 80, 164, 0.5)' : 'none',
                            transition: 'all 0.3s ease',
                            letterSpacing: '1px',
                        }}
                    >
                        🚀 START GAME
                    </button>
                </div>
            </div>
        );
    }

    // ---- Member: Ready Up ----
    return (
        <div className="controller-container" style={{ justifyContent: 'center', alignItems: 'center', padding: '2rem', position: 'relative' }}>
            <LeaveButton onLeave={onLeave} />
            <div
                style={{
                    maxWidth: '360px',
                    width: '100%',
                    background: 'var(--glass-bg)',
                    padding: '3rem 2rem',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--glass-border)',
                    backdropFilter: 'blur(20px)',
                    boxShadow: 'var(--glass-glow)',
                    animation: 'bounceIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    textAlign: 'center',
                }}
            >
                <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#fff', marginBottom: '0.25rem' }}>
                    {lobby?.team.name || 'Waiting for team...'}
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem' }}>
                    🎮 Team Member
                </p>

                {/* Member player name input */}
                {!playerNameSubmitted ? (
                    <div style={{
                        marginBottom: '1.5rem',
                        padding: '1rem',
                        background: 'rgba(139, 92, 246, 0.08)',
                        borderRadius: 'var(--radius-md)',
                        border: '2px solid rgba(139, 92, 246, 0.5)',
                        boxShadow: '0 0 20px rgba(139, 92, 246, 0.3)',
                        animation: isFadingOut ? 'fadeOut 0.3s ease-out forwards' : 'fadeIn 0.3s ease-out',
                    }}>
                        <p style={{ color: '#a78bfa', fontSize: '0.9rem', marginBottom: '0.75rem', fontWeight: 700, animation: 'pulse 2s infinite' }}>
                            ⚡ Enter your name to continue
                        </p>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                                type="text"
                                value={playerName}
                                onChange={(e) => setPlayerName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSubmitPlayerName()}
                                placeholder="Enter your name..."
                                maxLength={20}
                                autoFocus
                                style={{
                                    flex: 1,
                                    padding: '0.65rem 0.8rem',
                                    fontSize: '0.9rem',
                                    fontWeight: 700,
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '2px solid rgba(139, 92, 246, 0.6)',
                                    borderRadius: 'var(--radius-sm)',
                                    color: '#fff',
                                    outline: 'none',
                                    textAlign: 'center',
                                    fontFamily: 'var(--font-main)',
                                }}
                            />
                            <button
                                onClick={handleSubmitPlayerName}
                                disabled={playerName.trim().length < 2 || isFadingOut}
                                style={{
                                    padding: '0.65rem 1rem',
                                    fontSize: '0.85rem',
                                    fontWeight: 800,
                                    background: playerName.trim().length >= 2 ? 'var(--accent-success)' : 'rgba(255,255,255,0.1)',
                                    border: 'none',
                                    borderRadius: 'var(--radius-sm)',
                                    color: 'white',
                                    cursor: playerName.trim().length >= 2 && !isFadingOut ? 'pointer' : 'not-allowed',
                                }}
                            >✓</button>
                        </div>
                    </div>
                ) : null}

                {/* Members list */}
                <div style={{ marginBottom: '2rem' }}>
                    {lobby?.team.members.map((m) => (
                        <div
                            key={m.id}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '0.75rem 1rem',
                                marginBottom: '0.5rem',
                                background: 'rgba(255,255,255,0.05)',
                                borderRadius: 'var(--radius-sm)',
                                border: `1px solid ${m.isReady ? 'rgba(16,185,129,0.3)' : 'var(--glass-border)'}`,
                            }}
                        >
                            <span style={{ fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {m.role === 'leader' ? '👑' : '🎮'} {m.name || (m.role === 'leader' ? 'Leader' : 'Player')}
                                <span
                                    style={{
                                        width: '10px',
                                        height: '10px',
                                        borderRadius: '50%',
                                        background: CROSSHAIR_COLORS[m.colorIndex ?? 0] || CROSSHAIR_COLORS[0],
                                        boxShadow: `0 0 6px ${CROSSHAIR_COLORS[m.colorIndex ?? 0] || CROSSHAIR_COLORS[0]}`,
                                    }}
                                    title="Crosshair color"
                                />
                            </span>
                            <span
                                style={{
                                    color: m.isReady ? 'var(--accent-success)' : 'var(--text-secondary)',
                                    fontWeight: 700,
                                    fontSize: '0.85rem',
                                }}
                            >
                                {m.isReady ? '✓ Ready' : '⏳ Waiting'}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Show name confirmation after submission */}
                {playerNameSubmitted && (
                    <p style={{ color: 'var(--accent-success)', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 600 }}>
                        ✓ Playing as "{playerName.trim()}"
                    </p>
                )}

                {!isReady ? (
                    <button
                        onClick={handleReady}
                        disabled={!playerNameSubmitted}
                        style={{
                            width: '100%',
                            padding: '1.25rem 2rem',
                            fontSize: '1.3rem',
                            fontWeight: 900,
                            background: playerNameSubmitted ? 'var(--accent-success)' : 'rgba(255,255,255,0.08)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            color: playerNameSubmitted ? 'white' : 'var(--text-secondary)',
                            cursor: playerNameSubmitted ? 'pointer' : 'not-allowed',
                            boxShadow: playerNameSubmitted ? '0 8px 25px rgba(16, 185, 129, 0.4)' : 'none',
                            letterSpacing: '1px',
                        }}
                    >
                        ✋ I'M READY!
                    </button>
                ) : (
                    <div
                        style={{
                            padding: '1.25rem',
                            borderRadius: 'var(--radius-md)',
                            background: 'rgba(16, 185, 129, 0.15)',
                            border: '2px solid rgba(16, 185, 129, 0.3)',
                            color: 'var(--accent-success)',
                            fontWeight: 800,
                            fontSize: '1.1rem',
                        }}
                    >
                        ✓ Ready! Waiting for leader to start...
                    </div>
                )}
            </div>
        </div>
    );
}
