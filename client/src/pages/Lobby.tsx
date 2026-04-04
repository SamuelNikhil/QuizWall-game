// ==========================================
// Lobby Page — Presentation Layer
// Redesigned with character cards and lobby list
// ==========================================

import { useState } from 'react';
import type { LobbyState, PlayerRole } from '../shared/types';
import { CROSSHAIR_COLORS } from '../shared/types';
import '../index.css';

interface LobbyProps {
    role: PlayerRole;
    colorIndex: number;
    lobby: LobbyState | null;
    onSetPlayerName: (name: string) => void;
    onReady: () => void;
    onStartGame: () => void;
    onLeave: () => void;
    isSpectating?: boolean;
}

const preConfigNames = ["Wulf", "Talon", "Ryker", "Roux"];
const preConfigAvatars = ["wulf", "talon", "ryker", "roux"];

interface ConfirmationPopupProps {
    playerCount: number;
    readyPlayers: Array<{ name: string; colorIndex: number }>;
    onConfirm: () => void;
    onWait: () => void;
}

function ConfirmationPopup({ playerCount, readyPlayers, onConfirm, onWait }: ConfirmationPopupProps) {
    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'fadeIn 0.2s ease-out',
        }}>
            <div style={{
                background: 'linear-gradient(180deg, #1e1e2f 0%, #15151f 100%)',
                borderRadius: '24px',
                padding: '2rem',
                width: '90%',
                maxWidth: '340px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
                animation: 'bounceIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}>
                <h3 style={{
                    fontSize: '1.4rem',
                    fontWeight: 800,
                    color: '#fff',
                    textAlign: 'center',
                    marginBottom: '1.5rem',
                    lineHeight: 1.3,
                }}>
                    Start with {playerCount} {playerCount === 1 ? 'player' : 'players'}?
                </h3>

                <div style={{ marginBottom: '1.5rem' }}>
                    {readyPlayers.map((player, idx) => (
                        <div
                            key={idx}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '0.75rem 1rem',
                                marginBottom: idx < readyPlayers.length - 1 ? '0.5rem' : 0,
                                background: 'rgba(255, 255, 255, 0.03)',
                                borderRadius: '12px',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                            }}
                        >
                            <span style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                fontWeight: 700,
                                fontSize: '0.95rem',
                                color: CROSSHAIR_COLORS[player.colorIndex],
                            }}>
                                <span style={{
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '50%',
                                    background: CROSSHAIR_COLORS[player.colorIndex],
                                    boxShadow: `0 0 8px ${CROSSHAIR_COLORS[player.colorIndex]}`,
                                }} />
                                {player.name}
                            </span>
                            <span style={{
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                color: 'rgba(255, 255, 255, 0.5)',
                                textTransform: 'uppercase',
                            }}>
                                Ready
                            </span>
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <button
                        onClick={onConfirm}
                        style={{
                            width: '100%',
                            padding: '1rem',
                            fontSize: '1rem',
                            fontWeight: 800,
                            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                            border: 'none',
                            borderRadius: '16px',
                            color: '#fff',
                            cursor: 'pointer',
                            boxShadow: '0 8px 20px rgba(59, 130, 246, 0.4)',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'scale(1.02)';
                            e.currentTarget.style.boxShadow = '0 12px 30px rgba(59, 130, 246, 0.5)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'scale(1)';
                            e.currentTarget.style.boxShadow = '0 8px 20px rgba(59, 130, 246, 0.4)';
                        }}
                    >
                        Yes · start with {playerCount}
                    </button>
                    <button
                        onClick={onWait}
                        style={{
                            width: '100%',
                            padding: '1rem',
                            fontSize: '1rem',
                            fontWeight: 700,
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: '16px',
                            color: '#fff',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                        }}
                    >
                        Wait for more players
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function Lobby({
    role,
    colorIndex,
    lobby,
    onSetPlayerName,
    onReady,
    onStartGame,
    onLeave,
    isSpectating,
}: LobbyProps) {
    const [showConfirmPopup, setShowConfirmPopup] = useState(false);
    
    // Character setup
    const characterName = preConfigNames[colorIndex] || `Player ${colorIndex + 1}`;
    const characterAvatar = preConfigAvatars[colorIndex] || 'wulf';
    const characterColor = CROSSHAIR_COLORS[colorIndex] || '#6750A4';

    // Build lobby list (all 4 slots)
    const lobbySlots = [0, 1, 2, 3].map(slotIndex => {
        const player = lobby?.players.find(p => p.colorIndex === slotIndex);
        const isCurrentPlayer = slotIndex === colorIndex && role === 'member';
        
        if (player) {
            return {
                name: preConfigNames[slotIndex] || `Player ${slotIndex + 1}`,
                colorIndex: slotIndex,
                isReady: player.isReady,
                isCurrentPlayer,
            };
        }
        return {
            name: 'Talon',
            colorIndex: slotIndex,
            isReady: false,
            isEmpty: true,
            isCurrentPlayer,
        };
    });

    // Get ready players for popup
    const readyPlayers = lobby?.players
        .filter(p => p.isReady)
        .map(p => ({
            name: preConfigNames[p.colorIndex ?? 0] || `Player ${p.colorIndex! + 1}`,
            colorIndex: p.colorIndex ?? 0,
        })) || [];

    const playerCount = lobby?.players.length ?? 0;

    // ---- Leader: Lobby ----
    if (role === 'leader') {
        const canStart = playerCount >= 1;
        
        return (
            <div className="controller-container" style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '1.5rem',
                position: 'relative',
                minHeight: '100vh',
                background: 'linear-gradient(180deg, #0f0f1a 0%, #1a1a2e 100%)',
            }}>
                {/* Header - Connected Status */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '1.5rem',
                }}>
                    <span style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: characterColor,
                        boxShadow: `0 0 8px ${characterColor}`,
                        animation: 'pulse 2s ease-in-out infinite',
                    }} />
                    <span style={{
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        color: characterColor,
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                    }}>
                        Connected
                    </span>
                </div>

                {/* Character Card */}
                <div style={{
                    background: `linear-gradient(180deg, ${characterColor}15 0%, rgba(255, 255, 255, 0.02) 100%)`,
                    border: `2px solid ${characterColor}`,
                    borderRadius: '24px',
                    padding: '2rem 1.5rem',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    marginBottom: '2rem',
                    boxShadow: `0 10px 40px ${characterColor}20`,
                }}>
                    <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: 'rgba(255, 255, 255, 0.5)',
                        textTransform: 'uppercase',
                        letterSpacing: '2px',
                        marginBottom: '1rem',
                    }}>
                        Your Character
                    </span>
                    <img
                        src={`/avatars/${characterAvatar}.png`}
                        alt={characterName}
                        style={{
                            width: '140px',
                            height: '140px',
                            objectFit: 'contain',
                            filter: `drop-shadow(0 0 20px ${characterColor}40)`,
                        }}
                    />
                    <h2 style={{
                        fontSize: '2rem',
                        fontWeight: 900,
                        color: '#fff',
                        marginTop: '1rem',
                        textShadow: `0 0 20px ${characterColor}60`,
                    }}>
                        {characterName}
                    </h2>
                    <div style={{
                        marginTop: '0.75rem',
                        padding: '0.35rem 1rem',
                        background: `linear-gradient(135deg, ${characterColor}40, ${characterColor}20)`,
                        borderRadius: '20px',
                        border: `1px solid ${characterColor}60`,
                    }}>
                        <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            color: '#fff',
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                        }}>
                            Host
                        </span>
                    </div>
                </div>

                {/* Lobby Section */}
                <div style={{ flex: 1, marginBottom: '1.5rem' }}>
                    <span style={{
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        color: 'rgba(255, 255, 255, 0.4)',
                        textTransform: 'uppercase',
                        letterSpacing: '2px',
                        marginBottom: '1rem',
                        display: 'block',
                    }}>
                        Lobby
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {lobbySlots.filter(slot => !slot.isCurrentPlayer).map((slot, idx) => (
                            <div
                                key={idx}
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '0.85rem 1rem',
                                    background: slot.isEmpty
                                        ? 'rgba(255, 255, 255, 0.02)'
                                        : `linear-gradient(135deg, ${CROSSHAIR_COLORS[slot.colorIndex]}10 0%, rgba(255, 255, 255, 0.02) 100%)`,
                                    borderRadius: '14px',
                                    border: slot.isEmpty
                                        ? '1px dashed rgba(255, 255, 255, 0.1)'
                                        : `1px solid ${CROSSHAIR_COLORS[slot.colorIndex]}30`,
                                }}
                            >
                                <span style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.75rem',
                                    fontWeight: 700,
                                    fontSize: '1rem',
                                    color: slot.isEmpty ? 'rgba(255, 255, 255, 0.3)' : CROSSHAIR_COLORS[slot.colorIndex],
                                }}>
                                    <span style={{
                                        width: '10px',
                                        height: '10px',
                                        borderRadius: '50%',
                                        background: slot.isEmpty ? 'rgba(255, 255, 255, 0.2)' : CROSSHAIR_COLORS[slot.colorIndex],
                                        boxShadow: slot.isEmpty ? 'none' : `0 0 8px ${CROSSHAIR_COLORS[slot.colorIndex]}`,
                                    }} />
                                    {slot.isEmpty ? '•••' : slot.name}
                                </span>
                                {slot.isEmpty ? (
                                    <span style={{
                                        fontSize: '1.2rem',
                                        color: 'rgba(255, 255, 255, 0.15)',
                                        letterSpacing: '2px',
                                    }}>
                                        •••
                                    </span>
                                ) : (
                                    <span style={{
                                        fontSize: '0.75rem',
                                        fontWeight: 700,
                                        color: 'rgba(255, 255, 255, 0.5)',
                                        textTransform: 'uppercase',
                                    }}>
                                        Ready
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Helper Text */}
                <p style={{
                    fontSize: '0.8rem',
                    color: 'rgba(255, 255, 255, 0.4)',
                    textAlign: 'center',
                    marginBottom: '1rem',
                }}>
                    You can start with any number of players
                </p>

                {/* Start Game Button */}
                <button
                    onClick={() => {
                        if (playerCount < 4) {
                            setShowConfirmPopup(true);
                        } else {
                            onStartGame();
                        }
                    }}
                    disabled={!canStart || isSpectating}
                    style={{
                        width: '100%',
                        padding: '1.1rem',
                        fontSize: '1.2rem',
                        fontWeight: 900,
                        background: canStart && !isSpectating
                            ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'
                            : 'rgba(255, 255, 255, 0.08)',
                        border: 'none',
                        borderRadius: '20px',
                        color: canStart && !isSpectating ? '#fff' : 'rgba(255, 255, 255, 0.3)',
                        cursor: canStart && !isSpectating ? 'pointer' : 'not-allowed',
                        boxShadow: canStart && !isSpectating ? '0 8px 25px rgba(59, 130, 246, 0.4)' : 'none',
                        transition: 'all 0.2s ease',
                        letterSpacing: '0.5px',
                    }}
                    onMouseEnter={(e) => {
                        if (canStart && !isSpectating) {
                            e.currentTarget.style.transform = 'scale(1.02)';
                            e.currentTarget.style.boxShadow = '0 12px 35px rgba(59, 130, 246, 0.5)';
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (canStart && !isSpectating) {
                            e.currentTarget.style.transform = 'scale(1)';
                            e.currentTarget.style.boxShadow = '0 8px 25px rgba(59, 130, 246, 0.4)';
                        }
                    }}
                >
                    {isSpectating ? 'GAME IN PROGRESS' : 'Start Game'}
                </button>

                {/* Confirmation Popup */}
                {showConfirmPopup && (
                    <ConfirmationPopup
                        playerCount={playerCount}
                        readyPlayers={readyPlayers}
                        onConfirm={() => {
                            setShowConfirmPopup(false);
                            onStartGame();
                        }}
                        onWait={() => setShowConfirmPopup(false)}
                    />
                )}
            </div>
        );
    }

    // ---- Member: Ready Up ----
    return (
        <div className="controller-container" style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '1.5rem',
            position: 'relative',
            minHeight: '100vh',
            background: 'linear-gradient(180deg, #0f0f1a 0%, #1a1a2e 100%)',
        }}>
            {/* Header - Connected Status */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '1.5rem',
            }}>
                <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: characterColor,
                    boxShadow: `0 0 8px ${characterColor}`,
                    animation: 'pulse 2s ease-in-out infinite',
                }} />
                <span style={{
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: characterColor,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                }}>
                    Connected
                </span>
            </div>

            {/* Character Card */}
            <div style={{
                background: `linear-gradient(180deg, ${characterColor}15 0%, rgba(255, 255, 255, 0.02) 100%)`,
                border: `2px solid ${characterColor}`,
                borderRadius: '24px',
                padding: '2rem 1.5rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                marginBottom: '1.5rem',
                boxShadow: `0 10px 40px ${characterColor}20`,
            }}>
                <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: 'rgba(255, 255, 255, 0.5)',
                    textTransform: 'uppercase',
                    letterSpacing: '2px',
                    marginBottom: '1rem',
                }}>
                    Your Character
                </span>
                <img
                    src={`/avatars/${characterAvatar}.png`}
                    alt={characterName}
                    style={{
                        width: '140px',
                        height: '140px',
                        objectFit: 'contain',
                        filter: `drop-shadow(0 0 20px ${characterColor}40)`,
                    }}
                />
                <h2 style={{
                    fontSize: '2rem',
                    fontWeight: 900,
                    color: '#fff',
                    marginTop: '1rem',
                    textShadow: `0 0 20px ${characterColor}60`,
                }}>
                    {characterName}
                </h2>
            </div>

            {/* Ready Status */}
            <div style={{
                background: `linear-gradient(135deg, ${characterColor}20, ${characterColor}10)`,
                border: `1px solid ${characterColor}40`,
                borderRadius: '16px',
                padding: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                marginBottom: '1.5rem',
            }}>
                <span style={{ fontSize: '1.2rem', color: characterColor }}>✓</span>
                <span style={{
                    fontSize: '1rem',
                    fontWeight: 800,
                    color: '#fff',
                }}>
                    Ready to play
                </span>
            </div>

            <p style={{
                fontSize: '0.85rem',
                color: 'rgba(255, 255, 255, 0.4)',
                textAlign: 'center',
                marginBottom: '2rem',
            }}>
                Waiting for Host to start...
            </p>

            {/* Lobby Section */}
            <div style={{ flex: 1, marginBottom: '1.5rem' }}>
                <span style={{
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: 'rgba(255, 255, 255, 0.4)',
                    textTransform: 'uppercase',
                    letterSpacing: '2px',
                    marginBottom: '1rem',
                    display: 'block',
                }}>
                    Lobby
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {lobbySlots.filter(slot => !slot.isCurrentPlayer).map((slot, idx) => (
                        <div
                            key={idx}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '0.85rem 1rem',
                                background: slot.isEmpty
                                    ? 'rgba(255, 255, 255, 0.02)'
                                    : `linear-gradient(135deg, ${CROSSHAIR_COLORS[slot.colorIndex]}10 0%, rgba(255, 255, 255, 0.02) 100%)`,
                                borderRadius: '14px',
                                border: slot.isEmpty
                                    ? '1px dashed rgba(255, 255, 255, 0.1)'
                                    : `1px solid ${CROSSHAIR_COLORS[slot.colorIndex]}30`,
                            }}
                        >
                            <span style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                fontWeight: 700,
                                fontSize: '1rem',
                                color: slot.isEmpty ? 'rgba(255, 255, 255, 0.3)' : CROSSHAIR_COLORS[slot.colorIndex],
                            }}>
                                <span style={{
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '50%',
                                    background: slot.isEmpty ? 'rgba(255, 255, 255, 0.2)' : CROSSHAIR_COLORS[slot.colorIndex],
                                    boxShadow: slot.isEmpty ? 'none' : `0 0 8px ${CROSSHAIR_COLORS[slot.colorIndex]}`,
                                }} />
                                {slot.isEmpty ? '•••' : slot.name}
                            </span>
                            {slot.isEmpty ? (
                                <span style={{
                                    fontSize: '1.2rem',
                                    color: 'rgba(255, 255, 255, 0.15)',
                                    letterSpacing: '2px',
                                }}>
                                    •••
                                </span>
                            ) : (
                                <span style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                    color: 'rgba(255, 255, 255, 0.5)',
                                    textTransform: 'uppercase',
                                }}>
                                    Ready
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
