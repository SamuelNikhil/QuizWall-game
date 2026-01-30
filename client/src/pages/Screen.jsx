import { useEffect, useState, useRef, useCallback } from 'react';
import geckos from '@geckos.io/client';
import { QRCodeSVG } from 'qrcode.react';
import { getServerConfig } from '../config/network';
import '../animations.css';

const ORB_POSITIONS = [
  { left: '15%', top: '55%' },
  { left: '40%', top: '70%' },
  { left: '60%', top: '55%' },
  { left: '80%', top: '70%' },
];

const QUESTIONS = [
  {
    id: 1,
    text: "Which keyword is used to declare a constant in JavaScript?",
    code: "const x = 10;",
    options: [
      { id: 'A', text: 'var' },
      { id: 'B', text: 'let' },
      { id: 'C', text: 'const' },
      { id: 'D', text: 'constant' }
    ],
    correct: 'C'
  },
  {
    id: 2,
    text: "What does HTML stand for?",
    code: "<!DOCTYPE html>",
    options: [
      { id: 'A', text: 'Hyper Text Markup Language' },
      { id: 'B', text: 'High Tech Modern Language' },
      { id: 'C', text: 'Hyper Transfer Markup Language' },
      { id: 'D', text: 'Hyper Tool Multi Language' }
    ],
    correct: 'A'
  },
  {
    id: 3,
    text: "Which of these is a React Hook?",
    code: "const [state, setState] = ...",
    options: [
      { id: 'A', text: 'useAction' },
      { id: 'B', text: 'useState' },
      { id: 'C', text: 'useReact' },
      { id: 'D', text: 'useComponent' }
    ],
    correct: 'B'
  }
];

export default function Screen() {
  const [roomId, setRoomId] = useState(null);
  const [joinToken, setJoinToken] = useState(null);
  const [controllers, setControllers] = useState([]);
  const [scores, setScores] = useState({});
  const [projectiles, setProjectiles] = useState([]);
  const [hitEffects, setHitEffects] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [crosshair, setCrosshair] = useState(null);
  const [targetedOrbId, setTargetedOrbId] = useState(null);
  const [particles, setParticles] = useState([]);
  const [confetti, setConfetti] = useState([]);
  const [scorePopups, setScorePopups] = useState([]);
  const [channel, setChannel] = useState(null);
  const [timeLeft, setTimeLeft] = useState(30);
  const [isGameOver, setIsGameOver] = useState(false);
  const timerRef = useRef(null);
  const scoresRef = useRef({});

  const question = QUESTIONS[currentQuestion % QUESTIONS.length];

  const containerRef = useRef(null);
  const arenaRef = useRef(null);
  const channelRef = useRef(null);
  const connectedRef = useRef(false);
  const targetTimeoutRef = useRef(null);
  const handleShootRef = useRef(null);

  // Sync handleShoot ref to avoid stale closures in Geckos listeners
  useEffect(() => {
    handleShootRef.current = handleShoot;
  }, [handleShoot]);

  // Helper to create particles
  const createParticles = useCallback((x, y, count, color) => {
    const newParticles = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 50 + Math.random() * 100;
      newParticles.push({
        id: Math.random(),
        x,
        y,
        size: 4 + Math.random() * 6,
        color,
        '--tx': `${Math.cos(angle) * velocity}px`,
        '--ty': `${Math.sin(angle) * velocity}px`,
      });
    }
    setParticles((prev) => [...prev, ...newParticles]);
    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParticles.find((np) => np.id === p.id)));
    }, 1000);
  }, []);

  // Helper to create score popups
  const createScorePopup = useCallback((x, y, text, type) => {
    const id = Math.random();
    setScorePopups((prev) => [...prev, { id, x, y, text, type }]);
    setTimeout(() => {
      setScorePopups((prev) => prev.filter((s) => s.id !== id));
    }, 1500);
  }, []);

  // Helper to create ripple
  const createRipple = useCallback((x, y, color) => {
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.borderColor = color;
    ripple.style.backgroundColor = `${color}22`;
    arenaRef.current?.appendChild(ripple);
    setTimeout(() => ripple.remove(), 1000);
  }, []);

  // Helper for confetti
  const createConfetti = useCallback((x, y) => {
    const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722'];
    const newConfetti = [];
    for (let i = 0; i < 30; i++) {
      newConfetti.push({
        id: Math.random(),
        x,
        y,
        color: colors[Math.floor(Math.random() * colors.length)],
        width: 10 + Math.random() * 5,
        height: 10 + Math.random() * 5,
        '--dx': `${(Math.random() - 0.5) * 400}px`,
        '--dy': `${(Math.random() - 0.5) * 400}px`,
        '--rot': `${Math.random() * 720}deg`
      });
    }
    setConfetti((prev) => [...prev, ...newConfetti]);
    setTimeout(() => {
      setConfetti((prev) => prev.filter((c) => !newConfetti.find((nc) => nc.id === c.id)));
    }, 1500);
  }, []);

  useEffect(() => {
    const { geckosUrl, geckosPort, geckosPath } = getServerConfig();

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

    const handshakeTimeout = setTimeout(() => {
      if (!connectedRef.current) {
        console.error('[SCREEN] Handshake timeout');
      }
    }, 15000);

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
      console.log('Room created:', data.roomId);
      setRoomId(data.roomId);
      setJoinToken(data.joinToken);
    });

    io.on('controllerJoined', (data) => {
      console.log('Controller joined:', data.controllerId);
      setControllers((prev) => {
        if (prev.includes(data.controllerId)) return prev;
        return [...prev, data.controllerId];
      });
      setScores((prev) => {
        const next = { ...prev, [data.controllerId]: prev[data.controllerId] || 0 };
        scoresRef.current = next;
        return next;
      });
    });

    io.on('controllerLeft', (data) => {
      console.log('Controller left:', data.controllerId);
      setControllers((prev) => {
        const next = prev.filter((id) => id !== data.controllerId);
        // If no more players, reset the game state to fresh
        if (next.length === 0) {
          console.log('🔄 All players left. Resetting game state for next session.');
          setIsGameOver(false);
          setTimeLeft(30);
          setScores({});
          scoresRef.current = {};
          setCurrentQuestion(0);
        }
        return next;
      });
    });

    io.on('shoot', (data) => {
      handleShootRef.current?.(data);
    });

    io.on('crosshair', (data) => {
      setCrosshair({ x: data.x, y: data.y, controllerId: data.controllerId });
    });

    io.on('startAiming', (data) => {
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
      if (targetTimeoutRef.current) clearTimeout(targetTimeoutRef.current);
      targetTimeoutRef.current = setTimeout(() => setTargetedOrbId(null), 500);
    });

    io.on('restartGame', () => {
      console.log('🔄 Restarting game...');
      setScores({});
      scoresRef.current = {};
      setCurrentQuestion(0);
      setIsGameOver(false);
      setTimeLeft(30);
      setProjectiles([]);
      setHitEffects([]);
      setParticles([]);
      setConfetti([]);
      setScorePopups([]);
    });

    io.on('exitToLobby', () => {
      console.log('🏠 Returning to lobby...');
      setScores({});
      scoresRef.current = {};
      setCurrentQuestion(0);
      setIsGameOver(false);
      setTimeLeft(30);
    });

    return () => {
      clearTimeout(handshakeTimeout);
      if (connectedRef.current && channelRef.current) {
        try { channelRef.current.close(); } catch (e) { }
      }
      connectedRef.current = false;
    };
  }, []);

  const handleShoot = useCallback((data) => {
    const { controllerId, targetXPercent, targetYPercent } = data;
    const id = `shot-${Math.random().toString(36).substr(2, 9)}`;

    setTargetedOrbId(null);

    let targetX = (targetXPercent / 100) * window.innerWidth;
    let targetY = (targetYPercent / 100) * window.innerHeight;

    if (data.isTargetedShot) {
      // No offset needed, targetXPercent=50 already points to center
    }

    setProjectiles((prev) => [
      ...prev,
      { id, x: window.innerWidth / 2, y: window.innerHeight, targetX, targetY },
    ]);

    setTimeout(() => {
      setProjectiles((prev) => prev.filter((p) => p.id !== id));

      // Check collision with Restart Button if Game Over
      if (isGameOver) {
        const restartBtn = document.querySelector('.restart-button-target');
        if (restartBtn) {
          const rect = restartBtn.getBoundingClientRect();
          // Add a small buffer (20px) to make hitting easier
          const buffer = 20;
          console.log(`[Game] Shot location: ${targetX.toFixed(1)}, ${targetY.toFixed(1)}`);
          console.log(`[Game] Restart button rect: L:${rect.left.toFixed(1)}, R:${rect.right.toFixed(1)}, T:${rect.top.toFixed(1)}, B:${rect.bottom.toFixed(1)}`);

          if (targetX >= (rect.left - buffer) && targetX <= (rect.right + buffer) &&
            targetY >= (rect.top - buffer) && targetY <= (rect.bottom + buffer)) {
            console.log('🎯 RESTART BUTTON HIT!');

            // Add visual feedback for restart hit
            createRipple(targetX, targetY, '#6750A4');
            createParticles(targetX, targetY, 25, '#ffffff');

            if (channelRef.current) {
              channelRef.current.emit('restartGame');
            } else {
              setScores({});
              scoresRef.current = {};
              setCurrentQuestion(0);
              setIsGameOver(false);
              setTimeLeft(30);
            }
            return;
          }
        }
      }

      const orbElements = document.querySelectorAll('.orb');
      let hitOrb = null;

      orbElements.forEach((orb) => {
        const rect = orb.getBoundingClientRect();
        const orbCenterX = rect.left + rect.width / 2;
        const orbCenterY = rect.top + rect.height / 2;
        const distance = Math.sqrt(Math.pow(targetX - orbCenterX, 2) + Math.pow(targetY - orbCenterY, 2));
        if (distance < 60) hitOrb = orb.dataset.option;
      });

      if (hitOrb && !isGameOver) {
        const isCorrect = hitOrb === question.correct;
        orbElements.forEach(orb => {
          const isHitOrb = orb.dataset.option === hitOrb;
          const orbClass = isCorrect ? 'correct-answer' : 'wrong-answer';
          orb.classList.add(orbClass);
          if (isHitOrb) orb.classList.add('hit-orb');
        });

        setTimeout(() => {
          orbElements.forEach(orb => orb.classList.remove('correct-answer', 'wrong-answer', 'hit-orb'));
        }, 1200);

        setHitEffects((prev) => [...prev, { id, x: targetX, y: targetY, correct: isCorrect }]);
        setTimeout(() => setHitEffects((prev) => prev.filter((e) => e.id !== id)), 500);

        if (isCorrect) {
          createParticles(targetX, targetY, 20, '#10b981');
          createScorePopup(targetX, targetY, '+100', 'correct');
          createRipple(targetX, targetY, '#10b981');
          createConfetti(targetX, targetY);
          setScores((prev) => {
            const next = { ...prev, [controllerId]: (prev[controllerId] || 0) + 100 };
            scoresRef.current = next;
            return next;
          });
          if (channel) channel.emit('hitResult', { controllerId, correct: true, points: 100 });
          setTimeout(() => {
            setCurrentQuestion((prev) => prev + 1);
            setTimeLeft(30);
          }, 1500);
        } else {
          createParticles(targetX, targetY, 15, '#ef4444');
          createScorePopup(targetX, targetY, '✗', 'wrong');
          createRipple(targetX, targetY, '#ef4444');
          if (channel) channel.emit('hitResult', { controllerId, correct: false, points: 0 });
        }
      }
    }, 300);
  }, [channel, question, createParticles, createScorePopup, createRipple, createConfetti, isGameOver]);

  useEffect(() => {
    if (isGameOver || !roomId || controllers.length === 0) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        const next = Math.max(0, prev - 1);
        if (next === 0 && !isGameOver) {
          clearInterval(timerRef.current);
          setIsGameOver(true);
          if (channel) channel.emit('gameOver', { finalScores: scoresRef.current });
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [roomId, controllers.length, isGameOver, channel]);

  const controllerUrl = roomId && joinToken ? `${window.location.origin}/controller/${roomId}/${joinToken}` : '';

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
        <h1 style={{ fontSize: '4.5rem', marginBottom: '1.5rem', color: '#fff', fontWeight: '900', textShadow: '0 0 50px rgba(103, 80, 164, 0.6)', textAlign: 'center', letterSpacing: '-3px', lineHeight: '1.1', fontFamily: 'var(--font-main)' }}>
          Quiz Wall
        </h1>
        <div className="qr-content-wrapper">
          <div className="qr-left-column" style={{ display: 'flex' }}>
            <div className="qr-box-large">
              <QRCodeSVG value={controllerUrl} size={300} level="H" fgColor="#1C1B1F" />
            </div>
            <p style={{ marginTop: '2rem', fontSize: '1.25rem', fontWeight: '600', opacity: 0.8 }}>Scan to Play 🎯</p>
          </div>
          <div className="qr-leaderboard">
            <h3 style={{ fontFamily: 'var(--font-main)', fontWeight: '800' }}>Leaderboard</h3>
            {Object.keys(scores).length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.6, fontStyle: 'italic', fontSize: '1.2rem' }}>Waiting for challengers...</div>
            ) : (
              Object.entries(scores)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([id, score], i) => (
                  <div key={id} className="qr-leaderboard-item" style={{
                    borderRadius: 'var(--radius-md)',
                    border: i === 0 ? '2px solid var(--accent-primary)' : '1px solid var(--glass-border)',
                    background: i === 0 ? 'rgba(103, 80, 164, 0.2)' : 'var(--glass-bg)'
                  }}>
                    <span style={{ fontSize: '1.1rem' }}>{i === 0 ? '👑' : `#${i + 1}`} Player</span>
                    <span style={{ color: 'var(--accent-secondary)', fontWeight: '800', fontSize: '1.2rem' }}>{score} pts</span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-container" ref={containerRef}>
      <header className="screen-header" style={{ justifyContent: 'flex-end', padding: '3rem' }}>
        <div className="player-count-badge">
          <span style={{ fontSize: '1.5rem', filter: 'drop-shadow(0 0 10px rgba(103, 80, 164, 0.5))' }}>👥</span>
          <span style={{ fontWeight: '900', color: 'var(--text-primary)' }}>{controllers.length}</span>
          <div style={{ display: 'flex', gap: '20px', borderLeft: '2px solid var(--glass-border)', paddingLeft: '20px' }}>
            <span style={{ color: 'var(--accent-secondary)', fontWeight: '800', fontSize: '1.3rem' }}>
              High Score: {Math.max(0, ...Object.values(scores), 0)}
            </span>
          </div>
        </div>
        <div style={{ position: 'absolute', top: '0', left: '0', width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', zIndex: 1000 }}>
          <div style={{ width: `${(timeLeft / 30) * 100}%`, height: '100%', background: timeLeft <= 10 ? 'var(--accent-error)' : 'var(--accent-primary)', transition: 'width 1s linear, background 0.3s ease', boxShadow: `0 0 20px ${timeLeft <= 10 ? 'var(--accent-error)' : 'var(--accent-primary)'}` }} />
        </div>
        <div style={{ position: 'absolute', top: '4rem', left: '3rem', fontSize: '2.5rem', fontWeight: '900', color: timeLeft <= 10 ? 'var(--accent-error)' : 'var(--text-primary)', zIndex: 1000 }}>
          {timeLeft}s
        </div>
      </header>

      <div className="game-arena" ref={arenaRef}>
        {!isGameOver && (
          <div className="question-display">
            <p className="question-text" style={{ fontFamily: 'var(--font-main)', fontWeight: '800', color: '#fff' }}>{question.text}</p>
            <pre className="code-block" style={{ borderRadius: 'var(--radius-md)', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: 'var(--accent-secondary)', fontWeight: '600' }}>{question.code}</pre>
          </div>
        )}

        {isGameOver && (
          <div className="game-over-overlay">
            <h1 className="game-over-title">TIME'S UP!</h1>
            <div className="final-score-box">
              <h2 className="final-score-label">Final Score</h2>
              <p className="final-score-value">{Math.max(0, ...Object.values(scores), 0)}</p>
            </div>
            <div className="restart-button-target">
              <h2 className="restart-text">SHOOT TO RESTART</h2>
            </div>
            <p className="restart-instruction">Aim and shoot the button above!</p>
          </div>
        )}

        {!isGameOver && question.options.map((opt, i) => (
          <div key={opt.id} className={`orb orb-${opt.id.toLowerCase()} ${targetedOrbId === opt.id ? 'targeted' : ''}`} style={{ left: ORB_POSITIONS[i].left, top: ORB_POSITIONS[i].top, animationDelay: `${i * 0.5}s` }} data-option={opt.id}>
            {opt.id}: {opt.text}
          </div>
        ))}

        {projectiles.map((p) => (
          <div key={p.id} className="projectile" style={{ left: p.targetX - 10, top: p.targetY - 10 }} />
        ))}

        {crosshair && (
          <div className="crosshair-ui" style={{ left: `${crosshair.x}%`, top: `${crosshair.y}%` }}>
            <div className="cross-v" />
            <div className="cross-h" />
            <div className="cross-dot" />
          </div>
        )}

        {hitEffects.map((e) => (
          <div key={e.id} className={`hit-effect ${e.correct ? 'hit-correct' : 'hit-wrong'}`} style={{ left: e.x - 75, top: e.y - 75 }} />
        ))}

        {particles.map((p) => (
          <div key={p.id} className="particle particle-explode" style={{ left: p.x, top: p.y, width: p.size, height: p.size, backgroundColor: p.color, '--tx': p['--tx'], '--ty': p['--ty'] }} />
        ))}

        {scorePopups.map((s) => (
          <div key={s.id} className={`score-popup ${s.type}`} style={{ left: s.x - 50, top: s.y - 50 }}>{s.text}</div>
        ))}

        {confetti.map((c) => (
          <div key={c.id} className="confetti" style={{ left: c.x, top: c.y, width: c.width, height: c.height, backgroundColor: c.color, '--dx': c['--dx'], '--dy': c['--dy'], '--rot': c['--rot'] }} />
        ))}
      </div>
    </div>
  );
}
