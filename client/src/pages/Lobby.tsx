// ==========================================
// Lobby Page — Presentation Layer
// Players enter their name and ready up
// Leader can start the game
// ==========================================

import { useState, useEffect, useRef } from 'react';
import type { LobbyState, PlayerRole } from '../shared/types';
import { CROSSHAIR_COLORS } from '../shared/types';
import '../index.css';

interface LobbyProps {
    role: PlayerRole;
    colorIndex: number;
    lobby: LobbyState | null;
    persistentName?: string;
    onSetPlayerName: (name: string) => void;
    onReady: () => void;
    onStartGame: () => void;
    onLeave: () => void;
    isSpectating?: boolean;
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
    colorIndex,
    lobby,
    onSetPlayerName,
    onReady,
    onStartGame,
    onLeave,
    persistentName,
    isSpectating,
}: LobbyProps) {
    
    // Player name state - start empty, let user enter it
    // Helper to check if a name is a default system name
    const isDefaultName = (name?: string) => !name || name === 'Leader' || name.startsWith('Player ');

    // Player name state - start with persistent name if available and not a default system name
    const initialName = isDefaultName(persistentName) ? '' : (persistentName || '');
    const [playerName, setPlayerName] = useState(initialName);
    const [playerNameSubmitted, setPlayerNameSubmitted] = useState(!!initialName);
    const [isFadingOut, setIsFadingOut] = useState(false);
    const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Send persistent name to server on mount (so it replaces "Leader"/"Player" in player list)
    const hasSentPersistentName = useRef(false);
    useEffect(() => {
        if (persistentName && !isDefaultName(persistentName) && !hasSentPersistentName.current) {
            hasSentPersistentName.current = true;
            setPlayerName(persistentName);
            setPlayerNameSubmitted(true);
            onSetPlayerName(persistentName);
            // Auto-ready if the name is already known
            onReady();
        }

        return () => {
            if (fadeTimeoutRef.current) {
                clearTimeout(fadeTimeoutRef.current);
            }
        };
    }, [persistentName]);

    // Check if player already has a name set (from server state after game restart)
    useEffect(() => {
        if (lobby?.players) {
            const myPlayer = lobby.players.find(p => p.colorIndex === colorIndex);
            if (myPlayer?.name && myPlayer.name !== 'Leader' && !myPlayer.name.startsWith('Player ')) {
                // Player already has a custom name set - mark as submitted
                if (!playerNameSubmitted) {
                    setPlayerName(myPlayer.name);
                    setPlayerNameSubmitted(true);
                }
                
                // If they are not spectating and not ready on the server, auto-ready them
                if (!isSpectating && !myPlayer.isReady) {
                    onReady();
                }
            }
        }
    }, [lobby, colorIndex, isSpectating, playerNameSubmitted]);

    const handleSubmitPlayerName = () => {
        const trimmed = playerName.trim();
        if (trimmed.length < 2) return;
        
        // Save to localStorage for persistence across sessions
        localStorage.setItem('slingshot_player_name', trimmed);
        
        // Start fade out animation
        setIsFadingOut(true);
        
        // After animation, submit and hide
        fadeTimeoutRef.current = setTimeout(() => {
            onSetPlayerName(trimmed);
            setPlayerNameSubmitted(true);
            setIsFadingOut(false);
            
            // Auto-ready once name is submitted
            onReady();
        }, 300); // Match animation duration
    };

    // Removed handleReady - functionality moved into name submission flow

    // ---- Leader: Lobby (waiting for members to ready up) ----
    if (role === 'leader') {
        const memberCount = (lobby?.players.length ?? 1) - 1; // exclude leader
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
                        Game Lobby
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

                    {/* Players list */}
                    <div style={{ marginBottom: '2rem' }}>
                        {lobby?.players.map((p) => (
                            <div
                                key={p.id}
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '0.75rem 1rem',
                                    marginBottom: '0.5rem',
                                    background: 'rgba(255,255,255,0.05)',
                                    borderRadius: 'var(--radius-sm)',
                                    border: `1px solid ${p.isReady ? 'rgba(16,185,129,0.3)' : 'var(--glass-border)'}`,
                                }}
                            >
                                <span style={{ fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {p.role === 'leader' ? '👑' : '🎮'} {p.name || (p.role === 'leader' ? 'Leader' : 'Player')} {p.role === 'leader' ? '(You)' : ''}
                                    <span
                                        style={{
                                            width: '10px',
                                            height: '10px',
                                            borderRadius: '50%',
                                            background: CROSSHAIR_COLORS[p.colorIndex ?? 0] || CROSSHAIR_COLORS[0],
                                            boxShadow: `0 0 6px ${CROSSHAIR_COLORS[p.colorIndex ?? 0] || CROSSHAIR_COLORS[0]}`,
                                        }}
                                        title="Crosshair color"
                                    />
                                </span>
                                <span
                                    style={{
                                        color: p.isReady ? 'var(--accent-success)' : 'var(--text-secondary)',
                                        fontWeight: 700,
                                        fontSize: '0.85rem',
                                    }}
                                >
                                    {p.isReady ? '✓ Ready' : '⏳ Waiting'}
                                </span>
                            </div>
                        ))}
                    </div>

                    {memberCount === 0 && (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem', fontStyle: 'italic' }}>
                            Share the QR code for others to join!
                        </p>
                    )}

                    {/* Show name confirmation after submission */}
                    {playerNameSubmitted && !isSpectating && (
                        <p style={{ color: 'var(--accent-success)', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 600 }}>
                            ✓ Playing as "{playerName.trim()}"
                        </p>
                    )}

                    {isSpectating && (
                        <p style={{ color: '#ff9500', fontSize: '0.9rem', marginBottom: '1rem', fontWeight: 800, animation: 'pulse 1.5s infinite' }}>
                            👀 SPECTATING...
                        </p>
                    )}

                    <button
                        onClick={onStartGame}
                        disabled={!allReady || !playerNameSubmitted || isSpectating}
                        style={{
                            width: '100%',
                            padding: '1.25rem 2rem',
                            fontSize: '1.3rem',
                            fontWeight: 900,
                            background: allReady && playerNameSubmitted && !isSpectating ? 'var(--accent-primary)' : 'rgba(255,255,255,0.08)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            color: allReady && playerNameSubmitted && !isSpectating ? 'white' : 'var(--text-secondary)',
                            cursor: allReady && playerNameSubmitted && !isSpectating ? 'pointer' : 'not-allowed',
                            boxShadow: allReady && playerNameSubmitted && !isSpectating ? '0 8px 25px rgba(103, 80, 164, 0.5)' : 'none',
                            transition: 'all 0.3s ease',
                            letterSpacing: '1px',
                        }}
                    >
                        {isSpectating ? 'GAME IN PROGRESS' : '🚀 START GAME'}
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
                    Game Lobby
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

                {/* Players list */}
                <div style={{ marginBottom: '2rem' }}>
                    {lobby?.players.map((p) => (
                        <div
                            key={p.id}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '0.75rem 1rem',
                                marginBottom: '0.5rem',
                                background: 'rgba(255,255,255,0.05)',
                                borderRadius: 'var(--radius-sm)',
                                border: `1px solid ${p.isReady ? 'rgba(16,185,129,0.3)' : 'var(--glass-border)'}`,
                            }}
                        >
                            <span style={{ fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {p.role === 'leader' ? '👑' : '🎮'} {p.name || (p.role === 'leader' ? 'Leader' : 'Player')}
                                <span
                                    style={{
                                        width: '10px',
                                        height: '10px',
                                        borderRadius: '50%',
                                        background: CROSSHAIR_COLORS[p.colorIndex ?? 0] || CROSSHAIR_COLORS[0],
                                        boxShadow: `0 0 6px ${CROSSHAIR_COLORS[p.colorIndex ?? 0] || CROSSHAIR_COLORS[0]}`,
                                    }}
                                    title="Crosshair color"
                                />
                            </span>
                            <span
                                style={{
                                    color: p.isReady ? 'var(--accent-success)' : 'var(--text-secondary)',
                                    fontWeight: 700,
                                    fontSize: '0.85rem',
                                }}
                            >
                                {p.isReady ? '✓ Ready' : '⏳ Waiting'}
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

                {/* Status Message (Always show when name is set) */}
                {playerNameSubmitted && !isSpectating && (
                    <div
                        style={{
                            padding: '1.25rem',
                            borderRadius: 'var(--radius-md)',
                            background: 'rgba(16, 185, 129, 0.15)',
                            border: '2px solid rgba(16, 185, 129, 0.3)',
                            color: 'var(--accent-success)',
                            fontWeight: 800,
                            fontSize: '1.1rem',
                            animation: 'fadeIn 0.5s ease-out',
                        }}
                    >
                        ✓ Ready! Waiting for leader...
                    </div>
                )}

                {isSpectating && (
                    <div
                        style={{
                            padding: '1.25rem',
                            borderRadius: 'var(--radius-md)',
                            background: 'rgba(255, 149, 0, 0.15)',
                            border: '2px solid rgba(255, 149, 0, 0.3)',
                            color: '#ff9500',
                            fontWeight: 800,
                            fontSize: '1.1rem',
                            animation: 'pulse 1.5s infinite',
                        }}
                    >
                        👀 Spectating — Wait for next round
                    </div>
                )}
            </div>
        </div>
    );
}
