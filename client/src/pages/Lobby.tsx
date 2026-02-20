// ==========================================
// Lobby Page — Presentation Layer
// Leader: enters team name + Start Game button
// Member: I'm Ready button
// ==========================================

import { useState } from 'react';
import type { LobbyState, PlayerRole } from '../shared/types';
import '../index.css';

interface LobbyProps {
    role: PlayerRole;
    lobby: LobbyState | null;
    onSetTeamName: (name: string) => void;
    onReady: () => void;
    onStartGame: () => void;
    gyroEnabled: boolean;
    gyroCalibrated?: boolean;
    onRequestGyro: () => void;
}

export default function Lobby({
    role,
    lobby,
    onSetTeamName,
    onReady,
    onStartGame,
    gyroEnabled,
    gyroCalibrated = false,
    onRequestGyro
}: LobbyProps) {
    const [teamName, setTeamName] = useState('');
    const [nameSubmitted, setNameSubmitted] = useState(false);
    const [isReady, setIsReady] = useState(false);

    const handleSubmitName = () => {
        const trimmed = teamName.trim();
        if (trimmed.length < 2) return;
        onSetTeamName(trimmed);
        setNameSubmitted(true);
    };

    const handleReady = () => {
        setIsReady(true);
        onReady();
    };

    // If local nameSubmitted is false but the lobby already has a team name 
    // (e.g. on re-join/refresh), we should skip the entry dialog.
    const effectiveNameSubmitted = nameSubmitted || (lobby?.team.name && lobby.team.name.length >= 2);

    // ---- Leader: Team Name Dialog ----
    if (role === 'leader' && !effectiveNameSubmitted) {
        return (
            <div className="controller-container" style={{ justifyContent: 'center', alignItems: 'center', padding: '2rem' }}>
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
            <div className="controller-container" style={{ justifyContent: 'center', alignItems: 'center', padding: '2rem' }}>
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

                    {/* Gyro Setup */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <button
                            onClick={gyroEnabled ? undefined : onRequestGyro}
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                background: gyroEnabled ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                                color: gyroEnabled ? 'var(--accent-success)' : '#fff',
                                border: `1px solid ${gyroEnabled ? 'rgba(16, 185, 129, 0.4)' : 'var(--glass-border)'}`,
                                borderRadius: 'var(--radius-md)',
                                fontSize: '0.9rem',
                                fontWeight: 700,
                                cursor: gyroEnabled ? 'default' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.5rem',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            {gyroEnabled ? (gyroCalibrated ? '✅ Gyro Ready' : '⏳ Calibrating...') : '📱 Enable Motion Controls'}
                        </button>
                        {!gyroEnabled && (
                            <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                                Tap to enable gyro aiming (recommended)
                            </p>
                        )}
                    </div>

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
                                <span style={{ fontWeight: 700, color: '#fff' }}>
                                    {m.role === 'leader' ? '👑' : '🎮'} Player {m.role === 'leader' ? '(You)' : ''}
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

                    <button
                        onClick={onStartGame}
                        disabled={!allReady}
                        style={{
                            width: '100%',
                            padding: '1.25rem 2rem',
                            fontSize: '1.3rem',
                            fontWeight: 900,
                            background: allReady ? 'var(--accent-primary)' : 'rgba(255,255,255,0.08)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            color: allReady ? 'white' : 'var(--text-secondary)',
                            cursor: allReady ? 'pointer' : 'not-allowed',
                            boxShadow: allReady ? '0 8px 25px rgba(103, 80, 164, 0.5)' : 'none',
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
        <div className="controller-container" style={{ justifyContent: 'center', alignItems: 'center', padding: '2rem' }}>
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

                {/* Gyro Setup */}
                <div style={{ marginBottom: '1.5rem' }}>
                    <button
                        onClick={gyroEnabled ? undefined : onRequestGyro}
                        style={{
                            width: '100%',
                            padding: '0.75rem',
                            background: gyroEnabled ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                            color: gyroEnabled ? 'var(--accent-success)' : '#fff',
                            border: `1px solid ${gyroEnabled ? 'rgba(16, 185, 129, 0.4)' : 'var(--glass-border)'}`,
                            borderRadius: 'var(--radius-md)',
                            fontSize: '0.9rem',
                            fontWeight: 700,
                            cursor: gyroEnabled ? 'default' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        {gyroEnabled ? (gyroCalibrated ? '✅ Gyro Ready' : '⏳ Calibrating...') : '📱 Enable Motion Controls'}
                    </button>
                    {!gyroEnabled && (
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                            Tap to enable gyro aiming (recommended)
                        </p>
                    )}
                </div>

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
                            <span style={{ fontWeight: 700, color: '#fff' }}>
                                {m.role === 'leader' ? '👑 Leader' : '🎮 Player'}
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

                {!isReady ? (
                    <button
                        onClick={handleReady}
                        style={{
                            width: '100%',
                            padding: '1.25rem 2rem',
                            fontSize: '1.3rem',
                            fontWeight: 900,
                            background: 'var(--accent-success)',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            color: 'white',
                            cursor: 'pointer',
                            boxShadow: '0 8px 25px rgba(16, 185, 129, 0.4)',
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
