import { useEffect, useState, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import geckos from '@geckos.io/client';
import { getServerConfig } from '../config/network';
import '../animations.css';

const QUESTIONS = [
    {
        id: 1,
        text: 'What is the output of the following code?',
        code: `console.log(typeof null);`,
        options: [
            { id: 'A', text: 'null' },
            { id: 'B', text: 'object' },
            { id: 'C', text: 'undefined' },
            { id: 'D', text: 'string' },
        ],
        correct: 'B',
    },
    {
        id: 2,
        text: 'Which method removes the last element from an array?',
        code: `const arr = [1, 2, 3];\narr.???();`,
        options: [
            { id: 'A', text: 'shift()' },
            { id: 'B', text: 'pop()' },
            { id: 'C', text: 'slice()' },
            { id: 'D', text: 'splice()' },
        ],
        correct: 'B',
    },
    {
        id: 3,
        text: 'What does "===" check in JavaScript?',
        code: `1 === '1'`,
        options: [
            { id: 'A', text: 'Value only' },
            { id: 'B', text: 'Type only' },
            { id: 'C', text: 'Value and Type' },
            { id: 'D', text: 'Reference' },
        ],
        correct: 'C',
    },
];

const ORB_POSITIONS = [
    { left: '15%', top: '55%' },
    { left: '40%', top: '70%' },
    { left: '60%', top: '55%' },
    { left: '80%', top: '70%' },
];

export default function Screen() {
    const [roomId, setRoomId] = useState(null);
    const [joinToken, setJoinToken] = useState(null);
    const [channel, setChannel] = useState(null);
    const [controllers, setControllers] = useState([]);
    const [currentQuestion, setCurrentQuestion] = useState(0);
    const [projectiles, setProjectiles] = useState([]);
    const [hitEffects, setHitEffects] = useState([]);
    const [scores, setScores] = useState({});
    const [crosshair, setCrosshair] = useState(null); // { x: %, y: %, controllerId }
    const [targetedOrbId, setTargetedOrbId] = useState(null); // Current orb being hovered/targeted
    const arenaRef = useRef(null);
    const targetTimeoutRef = useRef(null);

    const question = QUESTIONS[currentQuestion % QUESTIONS.length];

    const channelRef = useRef(null);
    const connectedRef = useRef(false);

    useEffect(() => {
        const { geckosUrl, geckosPort, geckosPath } = getServerConfig();

        // Connect using configured mode (direct or proxy)
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

        io.onConnect((error) => {
            if (error) {
                console.error('❌ connect error', error);
                clearTimeout(handshakeTimeout);
                return;
            }
            console.log('✅ connected to server');
            connectedRef.current = true;
            setChannel(io);
            io.emit('createRoom');
        });

        io.on('open', () => {
            console.log('🎮 data channel open');
            clearTimeout(handshakeTimeout);
        });

        io.on('roomCreated', (data) => {
            console.log('Room created:', data.roomId, 'with token:', data.joinToken);
            setRoomId(data.roomId);
            setJoinToken(data.joinToken);
        });

        io.on('controllerJoined', (data) => {
            console.log('Controller joined (Single Player Mode):', data.controllerId);
            // Replace existing controller to ensure only 1 player (handles refreshes/ghosts)
            setControllers([data.controllerId]);
            setScores({ [data.controllerId]: 0 });
        });

        io.on('controllerLeft', (data) => {
            console.log('Controller left:', data.controllerId);
            setControllers((prev) => prev.filter((id) => id !== data.controllerId));
            setScores((prev) => {
                const newScores = { ...prev };
                delete newScores[data.controllerId];
                return newScores;
            });
            return () => {
                clearTimeout(handshakeTimeout);
                io.close();
            };
        });

        io.on('shoot', (data) => {
            setCrosshair(null); // Hide crosshair when shooting
            handleShoot(data);
        });

        // Crosshair events for gyro aiming
        io.on('crosshair', (data) => {
            setCrosshair({ x: data.x, y: data.y, controllerId: data.controllerId });
        });

        io.on('startAiming', (data) => {
            // Only show crosshair if gyro is enabled on the controller
            if (data.gyroEnabled) {
                setCrosshair({ x: 50, y: 50, controllerId: data.controllerId });
            } else {
                setCrosshair(null);
            }
        });

        io.on('cancelAiming', () => {
            setCrosshair(null);
            setTargetedOrbId(null);
        });

        io.on('targeting', (data) => {
            setTargetedOrbId(data.orbId);

            // Clear existing timeout
            if (targetTimeoutRef.current) clearTimeout(targetTimeoutRef.current);

            // Auto-clear targeted state after 500ms of no updates
            targetTimeoutRef.current = setTimeout(() => {
                setTargetedOrbId(null);
            }, 500);
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

    const handleShoot = useCallback((data) => {
        const { controllerId, targetXPercent, targetYPercent, power } = data;
        const id = `shot-${Math.random().toString(36).substr(2, 9)}`;

        // Clear targeting state when shot is fired
        setTargetedOrbId(null);

        // Convert percentages to actual pixel positions based on window size
        let targetX = (targetXPercent / 100) * window.innerWidth;
        let targetY = (targetYPercent / 100) * window.innerHeight;

        // Add 50px offset to center the hit on the orb (100x100) for touch-targeted shots
        if (data.isTargetedShot) {
            targetX += 50;
            targetY += 50;
        }

        // Add projectile
        setProjectiles((prev) => [
            ...prev,
            { id, x: window.innerWidth / 2, y: window.innerHeight, targetX, targetY },
        ]);

        // Animate projectile to target
        setTimeout(() => {
            setProjectiles((prev) => prev.filter((p) => p.id !== id));

            // Check collision with orbs
            const orbElements = document.querySelectorAll('.orb');
            let hitOrb = null;

            orbElements.forEach((orb) => {
                const rect = orb.getBoundingClientRect();
                const orbCenterX = rect.left + rect.width / 2;
                const orbCenterY = rect.top + rect.height / 2;
                const distance = Math.sqrt(
                    Math.pow(targetX - orbCenterX, 2) + Math.pow(targetY - orbCenterY, 2)
                );
                if (distance < 60) {
                    hitOrb = orb.dataset.option;
                }
            });

            if (hitOrb) {
                const isCorrect = hitOrb === question.correct;

                // Add visual animation to ALL orbs
                const orbElements = document.querySelectorAll('.orb');
                orbElements.forEach(orb => {
                    const isHitOrb = orb.dataset.option === hitOrb;
                    const orbClass = isCorrect ? 'correct-answer' : 'wrong-answer';
                    
                    // Add animation class to all orbs
                    orb.classList.add(orbClass);
                    
                    // For the hit orb, we'll make the animation more prominent
                    if (isHitOrb) {
                        orb.classList.add('hit-orb');
                    }
                });

                // Remove animation classes after completion
                setTimeout(() => {
                    orbElements.forEach(orb => {
                        orb.classList.remove('correct-answer', 'wrong-answer', 'hit-orb');
                    });
                }, 1200);

                // Add hit effect
                setHitEffects((prev) => [
                    ...prev,
                    { id, x: targetX, y: targetY, correct: isCorrect },
                ]);

                setTimeout(() => {
                    setHitEffects((prev) => prev.filter((e) => e.id !== id));
                }, 500);

                // Update score
                if (isCorrect) {
                    setScores((prev) => ({
                        ...prev,
                        [controllerId]: (prev[controllerId] || 0) + 100,
                    }));

                    // Send result back
                    if (channel) {
                        channel.emit('hitResult', { controllerId, correct: true, points: 100 });
                    }

                    // Next question after delay
                    setTimeout(() => {
                        setCurrentQuestion((prev) => prev + 1);
                    }, 1500);
                } else {
                    if (channel) {
                        channel.emit('hitResult', { controllerId, correct: false, points: 0 });
                    }
                }
            }
        }, 300);
    }, [channel, question]);

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

    if (controllers.length === 0) {
        return (
            <div className="qr-fullscreen">
                <h1 style={{
                    fontSize: '3.5rem',
                    marginBottom: '1rem',
                    color: '#fff',
                    fontWeight: '800',
                    textShadow: '0 0 40px rgba(99, 102, 241, 0.6)',
                    textAlign: 'center',
                    letterSpacing: '-2px',
                    lineHeight: '1.2'
                }}>
                    Code Quiz Wall
                </h1>

                <div className="qr-content-wrapper">
                    <div className="qr-left-column">
                        <div className="qr-box-large">
                            <QRCodeSVG value={controllerUrl} size={280} level="H" />
                        </div>
                    </div>

                    <div className="qr-leaderboard">
                        <h3>Leaderboard</h3>
                        {Object.keys(scores).length === 0 ? (
                            <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.6, fontStyle: 'italic', fontSize: '1.1rem' }}>
                                Waiting for players...
                            </div>
                        ) : (
                            Object.entries(scores)
                                .sort(([, a], [, b]) => b - a)
                                .slice(0, 5)
                                .map(([id, score], i) => (
                                    <div key={id} className="qr-leaderboard-item">
                                        <span>#{i + 1} Player</span>
                                        <span style={{ color: 'var(--accent-primary)' }}>{score} pts</span>
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
            <header className="screen-header" style={{ justifyContent: 'flex-end', padding: '2rem' }}>

                <div className="player-count-badge">
                    <span style={{ fontSize: '1.2rem' }}>👥</span>
                    <span style={{ fontWeight: 'bold', marginRight: '10px' }}>{controllers.length}</span>

                    <div style={{ display: 'flex', gap: '15px', borderLeft: '1px solid rgba(255,255,255,0.3)', paddingLeft: '15px' }}>
                        {Object.keys(scores).length === 0 ? (
                            <span style={{ opacity: 0.5, fontSize: '0.9rem' }}>Waiting for shots...</span>
                        ) : (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ opacity: 0.7, fontSize: '1rem' }}>Score:</span>
                                <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '1.2rem' }}>
                                    {Math.max(...Object.values(scores))}
                                </span>
                            </span>
                        )}
                    </div>
                </div>
            </header>

            <div className="game-arena" ref={arenaRef}>
                <div className="question-display">
                    <p className="question-text">{question.text}</p>
                    <pre className="code-block">{question.code}</pre>
                </div>

                {/* Answer Orbs */}
                {question.options.map((opt, i) => (
                    <div
                        key={opt.id}
                        className={`orb orb-${opt.id.toLowerCase()} ${targetedOrbId === opt.id ? 'targeted' : ''}`}
                        style={{
                            left: ORB_POSITIONS[i].left,
                            top: ORB_POSITIONS[i].top,
                            animationDelay: `${i * 0.5}s`,
                        }}
                        data-option={opt.id}
                    >
                        {opt.id}: {opt.text}
                    </div>
                ))}

                {/* Projectiles */}
                {projectiles.map((p) => (
                    <div
                        key={p.id}
                        className="projectile"
                        style={{
                            left: p.targetX - 10,
                            top: p.targetY - 10,
                            transition: 'all 0.3s ease-out',
                        }}
                    />
                ))}

                {/* Crosshair for gyro aiming */}
                {crosshair && (
                    <div
                        style={{
                            position: 'absolute',
                            left: `${crosshair.x}%`,
                            top: `${crosshair.y}%`,
                            transform: 'translate(-50%, -50%)',
                            width: '60px',
                            height: '60px',
                            border: '3px solid #fff',
                            borderRadius: '50%',
                            pointerEvents: 'none',
                            boxShadow: '0 0 20px rgba(255,255,255,0.5), inset 0 0 20px rgba(255,255,255,0.2)',
                            zIndex: 1000,
                        }}
                    >
                        {/* Crosshair lines */}
                        <div style={{
                            position: 'absolute',
                            left: '50%',
                            top: '0',
                            width: '2px',
                            height: '100%',
                            background: 'rgba(255,255,255,0.7)',
                            transform: 'translateX(-50%)',
                        }} />
                        <div style={{
                            position: 'absolute',
                            top: '50%',
                            left: '0',
                            height: '2px',
                            width: '100%',
                            background: 'rgba(255,255,255,0.7)',
                            transform: 'translateY(-50%)',
                        }} />
                        {/* Center dot */}
                        <div style={{
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '8px',
                            height: '8px',
                            background: '#ef4444',
                            borderRadius: '50%',
                            boxShadow: '0 0 10px #ef4444',
                        }} />
                    </div>
                )}

                {/* Hit Effects */}
                {hitEffects.map((e) => (
                    <div
                        key={e.id}
                        className={`hit-effect ${e.correct ? 'hit-correct' : 'hit-wrong'}`}
                        style={{
                            left: e.x - 75,
                            top: e.y - 75,
                        }}
                    />
                ))}

            </div>
        </div>
    );
}
