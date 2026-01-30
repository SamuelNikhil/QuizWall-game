import { useEffect, useState, useRef, useCallback } from 'react';
import geckos from '@geckos.io/client';
import QUESTIONS from '../assets/questions';
import { getServerConfig } from '../config/network';

export default function Screen() {
    const [roomId, setRoomId] = useState('');
    const [joinToken, setJoinToken] = useState('');
    const [controllers, setControllers] = useState([]);
    const [scores, setScores] = useState({});
    const [currentQuestion, setCurrentQuestion] = useState(0);
    const [particles, setParticles] = useState([]);
    const [scorePopups, setScorePopups] = useState([]);
    const [ripples, setRipples] = useState([]);
    const [confetti, setConfetti] = useState([]);
    const [hitEffects, setHitEffects] = useState([]);
    const [timeLeft, setTimeLeft] = useState(30);
    const [isGameOver, setIsGameOver] = useState(false);
    const [targetedOrbId, setTargetedOrbId] = useState(null);
    
    const timerRef = useRef(null);
    const targetTimeoutRef = useRef(null);
    const channelRef = useRef(null);
    const connectedRef = useRef(false);

    const question = QUESTIONS[currentQuestion % QUESTIONS.length];

    // Create particles function
    const createParticles = useCallback((x, y, count, color) => {
        const newParticles = [];
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count;
            const distance = 100 + Math.random() * 100;
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance;
            newParticles.push({
                id: `particle-${Date.now()}-${i}`,
                x: x,
                y: y,
                size: Math.random() * 8 + 4,
                color: color,
                '--tx': `${tx}px`,
                '--ty': `${ty}px`,
            });
        }
        setParticles((prev) => [...prev, ...newParticles]);
        setTimeout(() => {
            setParticles((prev) => prev.filter((p) => !newParticles.some((np) => np.id === p.id)));
        }, 1000);
    }, []);

    // Create score popup function
    const createScorePopup = useCallback((x, y, text, type) => {
        const id = `popup-${Date.now()}`;
        setScorePopups((prev) => [...prev, { id, x, y, text, type }]);
        setTimeout(() => {
            setScorePopups((prev) => prev.filter((p) => p.id !== id));
        }, 1500);
    }, []);

    // Create ripple function
    const createRipple = useCallback((x, y, color) => {
        const id = `ripple-${Date.now()}`;
        setRipples((prev) => [...prev, { id, x, y, color }]);
        setTimeout(() => {
            setRipples((prev) => prev.filter((r) => r.id !== id));
        }, 1000);
    }, []);

    // Create confetti function
    const createConfetti = useCallback((x, y) => {
        const newConfetti = [];
        for (let i = 0; i < 30; i++) {
            const dx = (Math.random() - 0.5) * 200;
            const dy = -Math.random() * 200 - 50;
            const rot = (Math.random() - 0.5) * 720;
            newConfetti.push({
                id: `confetti-${Date.now()}-${i}`,
                x: x,
                y: y,
                color: `hsl(${Math.random() * 360}, 100%, 60%)`,
                '--dx': `${dx}px`,
                '--dy': `${dy}px`,
                '--rot': `${rot}deg`,
            });
        }
        setConfetti((prev) => [...prev, ...newConfetti]);
        setTimeout(() => {
            setConfetti((prev) => prev.filter((c) => !newConfetti.some((nc) => nc.id === c.id)));
        }, 1500);
    }, []);

    useEffect(() => {
        const { geckosUrl, geckosPort, geckosPath } = getServerConfig();

        // Set timeout to detect hanging handshakes
        const handshakeTimeout = setTimeout(() => {
            if (!connectedRef.current) {
                console.error('[SCREEN] Handshake timeout - possible issues:');
                console.error('  - WebRTC data channel never opened (check for "🎮 data channel open")');
                console.error('  - ICE negotiation failed (network blocking WebRTC)');
                console.error('  - Server not responding to createRoom event');
                console.error('  - CORS or mixed-content issues');
                console.error('  - STUN/TURN servers unreachable');
            }
        }, 15000); // 15 second timeout

        const io = geckos({
            url: geckosUrl,
            port: geckosPort,
            ...(geckosPath && { path: geckosPath }),
            iceServers: [
                { urls: 'stun:stun.metered.ca:80' },
                {
                    urls: 'turn:global.relay.metered.ca:443',
                    username: 'admin',
                    credential: 'admin'
                }
            ]
        });
        channelRef.current = io;

        io.onConnect((error) => {
            if (error) {
                console.error('Connection error:', error);
                clearTimeout(handshakeTimeout);
                return;
            }
            console.log('Connected to server');
            connectedRef.current = true;
            
            // Request room creation
            io.emit('createRoom');
        });

        io.on('open', () => {
            console.log('🎮 data channel open');
            clearTimeout(handshakeTimeout);
        });

        io.on('roomCreated', (data) => {
            setRoomId(data.roomId);
            setJoinToken(data.joinToken);
            console.log('Room created:', data.roomId);
        });

        io.on('controllerJoined', (data) => {
            setControllers((prev) => [...prev, data.controllerId]);
            console.log('Controller joined:', data.controllerId);
        });

        io.on('controllerLeft', (data) => {
            setControllers((prev) => prev.filter(id => id !== data.controllerId));
            setScores((prev) => {
                const newScores = { ...prev };
                delete newScores[data.controllerId];
                return newScores;
            });
            console.log('Controller left:', data.controllerId);
        });

        io.on('aim', (data) => {
            // Low-priority update for aim visualization
        });

        io.on('crosshair', (data) => {
            // Visual feedback for crosshair position
        });

        io.on('startAiming', (data) => {
            // Controller started aiming
        });

        io.on('cancelAiming', (data) => {
            // Controller cancelled aiming
        });

        io.on('targeting', (data) => {
            setTargetedOrbId(data.orbId);
            // Clear the targeting after a delay
            if (targetTimeoutRef.current) {
                clearTimeout(targetTimeoutRef.current);
            }
            targetTimeoutRef.current = setTimeout(() => {
                setTargetedOrbId(null);
            }, 500);
        });

        io.on('restartGame', () => {
            console.log('🔄 Restarting game...');
            // Clear any existing timer before restarting
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            setScores({});
            setCurrentQuestion(0);
            setIsGameOver(false);
            setTimeLeft(30);
        });

        return () => {
            clearTimeout(handshakeTimeout);
            // Only close if actually connected
            if (connectedRef.current && channelRef.current) {
                try {
                    channelRef.current.close();
                } catch (e) {
                    // Ignore close errors
                }
            }
            connectedRef.current = false;
        };
    }, []);

    // Handle shooting logic
    useEffect(() => {
        if (!channelRef.current) return;

        const channel = channelRef.current;

        const handleShoot = (data) => {
            const { controllerId, targetXPercent, targetYPercent, power } = data;
            
            // Convert percentages to pixel coordinates (assuming 1920x1080 screen)
            const targetX = (targetXPercent / 100) * 1920;
            const targetY = (targetYPercent / 100) * 1080;

            // Find the closest orb to the target position
            const orbs = document.querySelectorAll('.orb');
            let closestOrb = null;
            let minDistance = Infinity;

            orbs.forEach((orb) => {
                const rect = orb.getBoundingClientRect();
                const orbX = rect.left + rect.width / 2;
                const orbY = rect.top + rect.height / 2;
                const distance = Math.sqrt(
                    Math.pow(targetX - orbX, 2) + Math.pow(targetY - orbY, 2)
                );

                if (distance < minDistance) {
                    minDistance = distance;
                    closestOrb = orb;
                }
            });

            // Check if we hit an orb (within a reasonable distance)
            if (closestOrb && minDistance < 150) {
                const orbId = closestOrb.dataset.orbId;
                const isCorrect = orbId === question.answer;

                // Add visual feedback to the orb
                closestOrb.classList.add('hit-orb');
                if (isCorrect) {
                    closestOrb.classList.add('correct-answer');
                } else {
                    closestOrb.classList.add('wrong-answer');
                }

                // Remove classes after animation completes
                setTimeout(() => {
                    closestOrb.classList.remove('hit-orb', 'correct-answer', 'wrong-answer');
                }, 1000);

                // Add hit effect
                const id = Date.now();
                setHitEffects((prev) => [
                    ...prev,
                    { id, x: targetX, y: targetY, correct: isCorrect },
                ]);

                setTimeout(() => {
                    setHitEffects((prev) => prev.filter((e) => e.id !== id));
                }, 500);

                // Enhanced feedback with particles and popups
                if (isCorrect) {
                    // Green particles for correct answer
                    createParticles(targetX, targetY, 20, '#10b981');
                    // Score popup
                    createScorePopup(targetX, targetY, '+100', 'correct');
                    // Ripple effect
                    createRipple(targetX, targetY, '#10b981');
                    // Confetti explosion
                    createConfetti(targetX, targetY);

                    // Update score
                    setScores((prev) => ({
                        ...prev,
                        [controllerId]: (prev[controllerId] || 0) + 100,
                    }));

                    // Send result back
                    channel.emit('hitResult', { controllerId, correct: true, points: 100 });

                    // Next question after delay
                    setTimeout(() => {
                        setCurrentQuestion((prev) => prev + 1);
                        setTimeLeft(30); // Reset timer for next question
                    }, 1500);
                } else {
                    // Red particles for wrong answer
                    createParticles(targetX, targetY, 15, '#ef4444');
                    // Score popup
                    createScorePopup(targetX, targetY, '✗', 'wrong');
                    // Ripple effect
                    createRipple(targetX, targetY, '#ef4444');

                    channel.emit('hitResult', { controllerId, correct: false, points: 0 });
                }
            }
        };

        channel.on('shoot', handleShoot);

        return () => {
            if (channel) {
                channel.removeListener('shoot', handleShoot);
            }
        };
    }, [channelRef, question, createParticles, createScorePopup, createRipple, createConfetti]);

    // Timer effect
    useEffect(() => {
        if (isGameOver || !roomId || controllers.length === 0) return;

        timerRef.current = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timerRef.current);
                    setIsGameOver(true);
                    if (channelRef.current) {
                        channelRef.current.emit('gameOver', { finalScores: scores });
                    }
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timerRef.current);
    }, [roomId, controllers.length, isGameOver, scores, channelRef.current]);

    const controllerUrl = roomId && joinToken
        ? `${window.location.origin}/controller/${roomId}/${joinToken}`
        : '';

    if (!roomId) {
        return (
            <div className="screen-container">
                <div className="waiting-screen">
                    <div className="pulse-ring" />
                    <h2 className="waiting-title">Connecting to Server...</h2>
                </div>
            </div>
        );
    }

    if (isGameOver) {
        return (
            <div className="screen-container">
                <div className="game-over-screen" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100vh',
                    textAlign: 'center',
                    animation: 'bounceIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)'
                }}>
                    <h1 style={{ fontSize: '6rem', fontWeight: '900', color: 'var(--accent-error)', textShadow: '0 0 50px rgba(179, 38, 30, 0.5)', marginBottom: '2rem' }}>TIME'S UP!</h1>
                    <div style={{ background: 'var(--glass-bg)', padding: '3rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(20px)', minWidth: '400px' }}>
                        <h2 style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>Final Score</h2>
                        <p style={{ fontSize: '4.5rem', fontWeight: '900', color: 'var(--accent-secondary)' }}>
                            {Math.max(0, ...Object.values(scores))}
                        </p>
                        <p style={{ marginTop: '2rem', color: 'var(--text-secondary)', fontSize: '1.2rem' }}>Check your controller to Restart or Exit</p>
                    </div>
                </div>
            </div>
        );
    }

    if (controllers.length === 0) {
        return (
            <div className="qr-fullscreen">
                <h1 style={{
                    fontSize: '4.5rem',
                    marginBottom: '1.5rem',
                    color: '#fff',
                    fontWeight: '900',
                    textShadow: '0 0 50px rgba(103, 80, 164, 0.6)',
                    textAlign: 'center',
                    letterSpacing: '-3px',
                    lineHeight: '1.1',
                    fontFamily: 'var(--font-main)'
                }}>
                    Code Quiz Wall
                </h1>

                <div className="qr-content-wrapper">
                    <div className="qr-left-column" style={{ display: 'flex' }}>
                        <div className="qr-box-large">
                            {/* QR Code would go here */}
                        </div>
                        <p style={{ marginTop: '2rem', fontSize: '1.25rem', fontWeight: '600', opacity: 0.8 }}>
                            Scan to Play 🎯
                        </p>
                    </div>

                    <div className="qr-leaderboard">
                        <h3 style={{ fontFamily: 'var(--font-main)', fontWeight: '800' }}>Leaderboard</h3>
                        {Object.keys(scores).length === 0 ? (
                            <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.6, fontStyle: 'italic', fontSize: '1.2rem' }}>
                                Waiting for challengers...
                            </div>
                        ) : (
                            Object.entries(scores)
                                .sort(([, a], [, b]) => b - a)
                                .slice(0, 5)
                                .map(([controllerId, score], index) => (
                                    <div key={controllerId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                        <span style={{ fontWeight: '700' }}>#{index + 1}</span>
                                        <span style={{ fontWeight: '600' }}>Score: {score}</span>
                                    </div>
                                ))
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="screen-container">
            {/* Background particles/visuals */}
            {particles.map((particle) => (
                <div
                    key={particle.id}
                    className="particle"
                    style={{
                        left: `${particle.x}px`,
                        top: `${particle.y}px`,
                        width: `${particle.size}px`,
                        height: `${particle.size}px`,
                        background: particle.color,
                        '--tx': particle['--tx'],
                        '--ty': particle['--ty'],
                    }}
                />
            ))}

            {/* Score popups */}
            {scorePopups.map((popup) => (
                <div
                    key={popup.id}
                    className={`score-popup ${popup.type}`}
                    style={{
                        left: `${popup.x}px`,
                        top: `${popup.y}px`,
                    }}
                >
                    {popup.text}
                </div>
            ))}

            {/* Ripples */}
            {ripples.map((ripple) => (
                <div
                    key={ripple.id}
                    className="ripple"
                    style={{
                        left: `${ripple.x}px`,
                        top: `${ripple.y}px`,
                        background: ripple.color,
                    }}
                />
            ))}

            {/* Confetti */}
            {confetti.map((c) => (
                <div
                    key={c.id}
                    className="confetti"
                    style={{
                        left: `${c.x}px`,
                        top: `${c.y}px`,
                        background: c.color,
                        '--dx': c['--dx'],
                        '--dy': c['--dy'],
                        '--rot': c['--rot'],
                    }}
                />
            ))}

            {/* Hit effects */}
            {hitEffects.map((effect) => (
                <div
                    key={effect.id}
                    style={{
                        position: 'absolute',
                        left: effect.x,
                        top: effect.y,
                        transform: 'translate(-50%, -50%)',
                        width: '100px',
                        height: '100px',
                        borderRadius: '50%',
                        background: effect.correct ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                        boxShadow: effect.correct
                            ? '0 0 50px rgba(16, 185, 129, 0.8), 0 0 100px rgba(16, 185, 129, 0.5)'
                            : '0 0 50px rgba(239, 68, 68, 0.8), 0 0 100px rgba(239, 68, 68, 0.5)',
                        animation: 'pulse 0.5s ease-out forwards',
                        pointerEvents: 'none',
                        zIndex: 1000,
                    }}
                />
            ))}

            {/* Game UI Overlay */}
            <div style={{
                position: 'absolute',
                top: '2rem',
                left: '2rem',
                right: '2rem',
                display: 'flex',
                justifyContent: 'space-between',
                zIndex: 100,
                fontFamily: 'var(--font-main)',
            }}>
                <div style={{
                    background: 'var(--glass-bg)',
                    padding: '1rem 1.5rem',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--glass-border)',
                    backdropFilter: 'blur(20px)',
                }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.25rem' }}>TIMER</div>
                    <div style={{ fontSize: '2.5rem', fontWeight: '900', color: timeLeft <= 5 ? 'var(--accent-error)' : 'var(--accent-primary)' }}>
                        {timeLeft}s
                    </div>
                </div>

                <div style={{
                    background: 'var(--glass-bg)',
                    padding: '1rem 1.5rem',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--glass-border)',
                    backdropFilter: 'blur(20px)',
                }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.25rem' }}>SCORE</div>
                    <div style={{ fontSize: '2.5rem', fontWeight: '900', color: 'var(--accent-secondary)' }}>
                        {Math.max(0, ...Object.values(scores))}
                    </div>
                </div>
            </div>

            {/* Question Display */}
            <div style={{
                position: 'absolute',
                bottom: '5rem',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--glass-bg)',
                padding: '2rem 3rem',
                borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--glass-border)',
                backdropFilter: 'blur(20px)',
                textAlign: 'center',
                maxWidth: '80%',
                zIndex: 100,
                animation: 'bounceIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                boxShadow: '0 20px 50px rgba(0, 0, 0, 0.3), 0 0 100px rgba(103, 80, 164, 0.2)',
            }}>
                <h2 style={{ fontSize: '2.5rem', fontWeight: '800', margin: '0 0 1.5rem 0', color: '#fff', fontFamily: 'var(--font-main)', letterSpacing: '-0.5px' }}>
                    Question {currentQuestion + 1}
                </h2>
                <p style={{ fontSize: '2rem', fontWeight: '600', margin: 0, color: 'var(--text-primary)', lineHeight: '1.4' }}>
                    {question.question}
                </p>
            </div>

            {/* Orbs Container */}
            <div className="orbs-container" style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '80%',
                height: '60%',
            }}>
                {/* Orb A */}
                <div
                    className={`orb ${targetedOrbId === 'A' ? 'targeted' : ''}`}
                    data-orb-id="A"
                    style={{
                        position: 'absolute',
                        left: '15%',
                        top: '55%',
                        width: '120px',
                        height: '120px',
                        borderRadius: '50%',
                        background: 'var(--accent-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '3rem',
                        fontWeight: '900',
                        color: 'white',
                        boxShadow: targetedOrbId === 'A' 
                            ? '0 0 0 8px rgba(255, 255, 255, 0.5), 0 0 30px var(--accent-primary)'
                            : '0 10px 30px rgba(0, 0, 0, 0.3)',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                        cursor: 'pointer',
                        animation: targetedOrbId === 'A' ? 'pulse 1s infinite' : 'expressiveFloat 4s ease-in-out infinite',
                        transform: targetedOrbId === 'A' ? 'scale(1.1)' : 'scale(1)',
                    }}
                >
                    A
                </div>

                {/* Orb B */}
                <div
                    className={`orb ${targetedOrbId === 'B' ? 'targeted' : ''}`}
                    data-orb-id="B"
                    style={{
                        position: 'absolute',
                        left: '40%',
                        top: '70%',
                        width: '120px',
                        height: '120px',
                        borderRadius: '50%',
                        background: 'var(--accent-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '3rem',
                        fontWeight: '900',
                        color: 'white',
                        boxShadow: targetedOrbId === 'B' 
                            ? '0 0 0 8px rgba(255, 255, 255, 0.5), 0 0 30px var(--accent-secondary)'
                            : '0 10px 30px rgba(0, 0, 0, 0.3)',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                        cursor: 'pointer',
                        animation: targetedOrbId === 'B' ? 'pulse 1s infinite' : 'expressiveFloat 4s ease-in-out infinite 0.5s',
                        transform: targetedOrbId === 'B' ? 'scale(1.1)' : 'scale(1)',
                    }}
                >
                    B
                </div>

                {/* Orb C */}
                <div
                    className={`orb ${targetedOrbId === 'C' ? 'targeted' : ''}`}
                    data-orb-id="C"
                    style={{
                        position: 'absolute',
                        left: '60%',
                        top: '55%',
                        width: '120px',
                        height: '120px',
                        borderRadius: '50%',
                        background: 'var(--accent-tertiary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '3rem',
                        fontWeight: '900',
                        color: 'white',
                        boxShadow: targetedOrbId === 'C' 
                            ? '0 0 0 8px rgba(255, 255, 255, 0.5), 0 0 30px var(--accent-tertiary)'
                            : '0 10px 30px rgba(0, 0, 0, 0.3)',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                        cursor: 'pointer',
                        animation: targetedOrbId === 'C' ? 'pulse 1s infinite' : 'expressiveFloat 4s ease-in-out infinite 1s',
                        transform: targetedOrbId === 'C' ? 'scale(1.1)' : 'scale(1)',
                    }}
                >
                    C
                </div>

                {/* Orb D */}
                <div
                    className={`orb ${targetedOrbId === 'D' ? 'targeted' : ''}`}
                    data-orb-id="D"
                    style={{
                        position: 'absolute',
                        left: '80%',
                        top: '70%',
                        width: '120px',
                        height: '120px',
                        borderRadius: '50%',
                        background: 'var(--accent-quaternary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '3rem',
                        fontWeight: '900',
                        color: 'white',
                        boxShadow: targetedOrbId === 'D' 
                            ? '0 0 0 8px rgba(255, 255, 255, 0.5), 0 0 30px var(--accent-quaternary)'
                            : '0 10px 30px rgba(0, 0, 0, 0.3)',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                        cursor: 'pointer',
                        animation: targetedOrbId === 'D' ? 'pulse 1s infinite' : 'expressiveFloat 4s ease-in-out infinite 1.5s',
                        transform: targetedOrbId === 'D' ? 'scale(1.1)' : 'scale(1)',
                    }}
                >
                    D
                </div>
            </div>
        </div>
    );
}
