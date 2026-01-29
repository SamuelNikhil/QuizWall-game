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
    const [controllers, setControllers] = useState([]);
    const [currentQuestion, setCurrentQuestion] = useState(0);
    const [projectiles, setProjectiles] = useState([]);
    const [hitEffects, setHitEffects] = useState([]);
    const [scores, setScores] = useState({});
    const [crosshair, setCrosshair] = useState(null);
    const [targetedOrbId, setTargetedOrbId] = useState(null);
    const [isGyroMode, setIsGyroMode] = useState(false);
    const [isAiming, setIsAiming] = useState(false);
    
    // Visual effects state
    const [particles, setParticles] = useState([]);
    const [scorePopups, setScorePopups] = useState([]);
    const [ripples, setRipples] = useState([]);
    const [confetti, setConfetti] = useState([]);

    const arenaRef = useRef(null);
    const containerRef = useRef(null);
    
    // Stability Refs
    const isGyroModeRef = useRef(false);
    const currentCorrectAnswerRef = useRef(QUESTIONS[0].correct);
    const channelRef = useRef(null);

    const question = QUESTIONS[currentQuestion % QUESTIONS.length];

    useEffect(() => {
        currentCorrectAnswerRef.current = question.correct;
    }, [question]);

    const createParticles = useCallback((x, y, count, color) => {
        const newParticles = [];
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count;
            const distance = 100 + Math.random() * 100;
            newParticles.push({
                id: `p-${Date.now()}-${i}`,
                x, y, size: Math.random() * 8 + 4, color,
                '--tx': `${Math.cos(angle) * distance}px`,
                '--ty': `${Math.sin(angle) * distance}px`,
            });
        }
        setParticles(prev => [...prev, ...newParticles]);
        setTimeout(() => setParticles(prev => prev.filter(p => !newParticles.includes(p))), 1000);
    }, []);

    const createScorePopup = useCallback((x, y, text, type) => {
        const id = `s-${Date.now()}`;
        setScorePopups(prev => [...prev, { id, x, y, text, type }]);
        setTimeout(() => setScorePopups(prev => prev.filter(p => p.id !== id)), 1500);
    }, []);

    const createRipple = useCallback((x, y, color) => {
        const id = `r-${Date.now()}`;
        setRipples(prev => [...prev, { id, x, y, color, size: 60 }]);
        setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 1000);
    }, []);

    const createConfetti = useCallback((x, y) => {
        const newConfetti = [];
        const colors = ['#10b981', '#ffffff', '#fbbf24'];
        for (let i = 0; i < 30; i++) {
            newConfetti.push({
                id: `c-${Date.now()}-${i}`,
                x: x + (Math.random() - 0.5) * 50,
                y: y + (Math.random() - 0.5) * 50,
                color: colors[Math.floor(Math.random() * colors.length)],
                '--dx': `${(Math.random() - 0.5) * 400}px`,
                '--dy': `${-Math.random() * 300 - 100}px`,
                '--rot': `${Math.random() * 720 - 360}deg`,
                width: Math.random() * 10 + 5,
                height: Math.random() * 10 + 5,
            });
        }
        setConfetti(prev => [...prev, ...newConfetti]);
        setTimeout(() => setConfetti(prev => prev.filter(c => !newConfetti.includes(c))), 1500);
    }, []);

    const handleShootInternal = useCallback((data) => {
        const { controllerId, targetXPercent, targetYPercent, isTargetedShot } = data;
        const id = `shot-${Date.now()}`;

        setTargetedOrbId(null);
        setIsAiming(false);

        let targetX = (targetXPercent / 100) * window.innerWidth;
        let targetY = (targetYPercent / 100) * window.innerHeight;

        if (isTargetedShot) {
            targetX += 50; targetY += 50;
        }

        setProjectiles(prev => [...prev, { id, x: window.innerWidth / 2, y: window.innerHeight, targetX, targetY }]);

        setTimeout(() => {
            setProjectiles(prev => prev.filter(p => p.id !== id));
            
            const orbEls = document.querySelectorAll('.orb');
            let hitOrb = null;

            orbEls.forEach(orb => {
                const rect = orb.getBoundingClientRect();
                const dist = Math.sqrt(Math.pow(targetX - (rect.left + rect.width/2), 2) + Math.pow(targetY - (rect.top + rect.height/2), 2));
                if (dist < 60) hitOrb = orb.dataset.option;
            });

            if (hitOrb) {
                const correct = hitOrb === currentCorrectAnswerRef.current;
                
                orbEls.forEach(orb => {
                    const statusClass = correct ? 'correct-answer' : 'wrong-answer';
                    orb.classList.add(statusClass);
                    if (orb.dataset.option === hitOrb) orb.classList.add('hit-orb');
                });

                setTimeout(() => {
                    orbEls.forEach(orb => orb.classList.remove('correct-answer', 'wrong-answer', 'hit-orb'));
                }, 1200);

                setHitEffects(prev => [...prev, { id, x: targetX, y: targetY, correct }]);
                setTimeout(() => setHitEffects(prev => prev.filter(e => e.id !== id)), 500);

                if (correct) {
                    createParticles(targetX, targetY, 20, '#10b981');
                    createScorePopup(targetX, targetY, '+100', 'correct');
                    createRipple(targetX, targetY, '#10b981');
                    createConfetti(targetX, targetY);
                    setScores(prev => ({ ...prev, [controllerId]: (prev[controllerId] || 0) + 100 }));
                    if (channelRef.current) channelRef.current.emit('hitResult', { controllerId, correct: true, points: 100 });
                    setTimeout(() => setCurrentQuestion(prev => prev + 1), 1500);
                } else {
                    createParticles(targetX, targetY, 15, '#ef4444');
                    createScorePopup(targetX, targetY, '✗', 'wrong');
                    createRipple(targetX, targetY, '#ef4444');
                    if (channelRef.current) channelRef.current.emit('hitResult', { controllerId, correct: false, points: 0 });
                }
            }
        }, 300);
    }, [createParticles, createScorePopup, createRipple, createConfetti]);

    useEffect(() => {
        const { geckosUrl, geckosPort, geckosPath } = getServerConfig();
        const io = geckos({
            url: geckosUrl, port: geckosPort, ...(geckosPath && { path: geckosPath }),
            iceServers: [{ urls: 'stun:stun.metered.ca:80' }]
        });
        channelRef.current = io;

        io.onConnect(error => {
            if (error) return;
            io.emit('createRoom');
        });

        io.on('roomCreated', data => {
            setRoomId(data.roomId);
            setJoinToken(data.joinToken);
        });

        io.on('controllerJoined', data => {
            setControllers([data.controllerId]);
            setScores(prev => ({ ...prev, [data.controllerId]: (prev[data.controllerId] || 0) }));
        });

        io.on('shoot', handleShootInternal);

        io.on('startAiming', data => {
            const isGyro = !!data.gyroEnabled;
            isGyroModeRef.current = isGyro;
            setIsGyroMode(isGyro);
            setIsAiming(true);
            if (isGyro) setCrosshair({ x: 50, y: 50, controllerId: data.controllerId });
            else setTargetedOrbId(null);
        });

        io.on('cancelAiming', () => {
            setIsAiming(false);
            setTargetedOrbId(null);
            setCrosshair(null);
            isGyroModeRef.current = false;
        });

        io.on('crosshair', data => {
            if (isGyroModeRef.current) {
                setCrosshair({ x: data.x, y: data.y, controllerId: data.controllerId });
            }
        });

        io.on('targeting', data => {
            if (!isGyroModeRef.current && data.orbId) {
                setTargetedOrbId(data.orbId);
            }
        });

        return () => { if (channelRef.current) channelRef.current.close(); };
    }, [handleShootInternal]);

    if (!roomId) return <div className="screen-container"><div className="waiting-screen"><div className="pulse-ring" /><h2>Connecting...</h2></div></div>;

    // QR VIEW - Hidden on mobile via CSS
    if (controllers.length === 0) return (
        <div className="qr-fullscreen">
            <h1 className="qr-title">Code Quiz Wall</h1>
            <div className="qr-content-wrapper">
                <div className="qr-box-large mobile-hide">
                    <QRCodeSVG value={`${window.location.origin}/controller/${roomId}/${joinToken}`} size={280} level="H" />
                </div>
                <div className="qr-leaderboard mobile-full-width">
                    <h3>Leaderboard</h3>
                    <p className="room-code">Room: {roomId}</p>
                    <p className="join-url mobile-show">{window.location.origin}/controller/{roomId}/{joinToken}</p>
                    {Object.entries(scores).length === 0 ? <p>Waiting for players...</p> : 
                        Object.entries(scores).map(([id, score]) => <div key={id} className="qr-leaderboard-item"><span>Player</span><span>{score} pts</span></div>)
                    }
                </div>
            </div>
        </div>
    );

    return (
        <div className="screen-container" ref={containerRef}>
            <header className="screen-header">
                <div className="player-count-badge">
                    <span>👥 {controllers.length}</span>
                    <span className="score-divider">|</span>
                    <span>Score: {Math.max(0, ...Object.values(scores))}</span>
                </div>
            </header>

            <div className="game-arena" ref={arenaRef}>
                <div className="question-display">
                    <p className="question-text">{question.text}</p>
                    <pre className="code-block">{question.code}</pre>
                </div>

                {question.options.map((opt, i) => (
                    <div
                        key={opt.id}
                        className={`orb orb-${opt.id.toLowerCase()} ${!isGyroMode && isAiming && targetedOrbId === opt.id ? 'targeted' : ''}`}
                        style={{ left: ORB_POSITIONS[i].left, top: ORB_POSITIONS[i].top, animationDelay: `${i * 0.2}s` }}
                        data-option={opt.id}
                    >
                        {opt.id}: {opt.text}
                    </div>
                ))}

                {projectiles.map(p => <div key={p.id} className="projectile" style={{ left: p.targetX - 10, top: p.targetY - 10 }} />)}
                
                {crosshair && (
                    <div className="gyro-crosshair" style={{ left: `${crosshair.x}%`, top: `${crosshair.y}%` }}>
                        <div className="crosshair-dot" />
                    </div>
                )}

                {hitEffects.map(e => <div key={e.id} className={`hit-effect ${e.correct ? 'hit-correct' : 'hit-wrong'}`} style={{ left: e.x - 75, top: e.y - 75 }} />)}

                {particles.map(p => <div key={p.id} className="particle particle-explode" style={{ left: p.x, top: p.y, width: p.size, height: p.size, backgroundColor: p.color, '--tx': p['--tx'], '--ty': p['--ty'] }} />)}
                {scorePopups.map(s => <div key={s.id} className={`score-popup ${s.type}`} style={{ left: s.x, top: s.y }}>{s.text}</div>)}
                {ripples.map(r => <div key={r.id} className="ripple" style={{ left: r.x - r.size/2, top: r.y - r.size/2, width: r.size, height: r.size, border: `3px solid ${r.color}` }} />)}
                {confetti.map(c => <div key={c.id} className="confetti" style={{ left: c.x, top: c.y, width: c.width, height: c.height, backgroundColor: c.color, '--dx': c['--dx'], '--dy': c['--dy'], '--rot': c['--rot'] }} />)}
            </div>
        </div>
    );
}
