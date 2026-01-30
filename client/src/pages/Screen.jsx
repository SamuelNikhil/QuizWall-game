import { useEffect, useState, useRef, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import geckos from "@geckos.io/client";
import { getServerConfig } from "../config/network";
import "../animations.css";

const QUESTIONS = [
  {
    id: 1,
    text: "What is the output of the following code?",
    code: `console.log(typeof null);`,
    options: [
      { id: "A", text: "null" },
      { id: "B", text: "object" },
      { id: "C", text: "undefined" },
      { id: "D", text: "string" },
    ],
    correct: "B",
  },
  {
    id: 2,
    text: "Which method removes the last element from an array?",
    code: `const arr = [1, 2, 3];\narr.???();`,
    options: [
      { id: "A", text: "shift()" },
      { id: "B", text: "pop()" },
      { id: "C", text: "slice()" },
      { id: "D", text: "splice()" },
    ],
    correct: "B",
  },
  {
    id: 3,
    text: 'What does "===" check in JavaScript?',
    code: `1 === '1'`,
    options: [
      { id: "A", text: "Value only" },
      { id: "B", text: "Type only" },
      { id: "C", text: "Value and Type" },
      { id: "D", text: "Reference" },
    ],
    correct: "C",
  },
];

const ORB_POSITIONS = [
  { left: "15%", top: "55%" },
  { left: "40%", top: "70%" },
  { left: "60%", top: "55%" },
  { left: "80%", top: "70%" },
];

const ORB_COLORS = {
  A: "from-violet-500 to-purple-600",
  B: "from-pink-500 to-rose-600",
  C: "from-amber-400 to-orange-500",
  D: "from-cyan-400 to-blue-500",
};

const ORB_GLOW_COLORS = {
  A: "rgba(139, 92, 246, 0.6)",
  B: "rgba(236, 72, 153, 0.6)",
  C: "rgba(251, 191, 36, 0.6)",
  D: "rgba(6, 182, 212, 0.6)",
};

export default function Screen() {
  const [roomId, setRoomId] = useState(null);
  const [joinToken, setJoinToken] = useState(null);
  const [channel, setChannel] = useState(null);
  const [controllers, setControllers] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [projectiles, setProjectiles] = useState([]);
  const [hitEffects, setHitEffects] = useState([]);
  const [scores, setScores] = useState({});
  const [crosshair, setCrosshair] = useState(null);
  const [targetedOrbId, setTargetedOrbId] = useState(null);
  const arenaRef = useRef(null);
  const containerRef = useRef(null);
  const targetTimeoutRef = useRef(null);
  const [particles, setParticles] = useState([]);
  const [scorePopups, setScorePopups] = useState([]);
  const [ripples, setRipples] = useState([]);
  const [confetti, setConfetti] = useState([]);

  // Timer states
  const [timeLeft, setTimeLeft] = useState(30);
  const [isGameOver, setIsGameOver] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const timerRef = useRef(null);

  const question = QUESTIONS[currentQuestion % QUESTIONS.length];
  const channelRef = useRef(null);
  const connectedRef = useRef(false);

  // Timer effect - starts when question loads
  useEffect(() => {
    if (!roomId || controllers.length === 0 || isGameOver) return;

    // Reset timer when question changes
    setTimeLeft(30);

    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    // Start countdown
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          // Game over - time's up
          const maxScore = Math.max(...Object.values(scores), 0);
          setFinalScore(maxScore);
          setIsGameOver(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [currentQuestion, roomId, controllers.length, scores, isGameOver]);

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
        "--tx": `${tx}px`,
        "--ty": `${ty}px`,
      });
    }
    setParticles((prev) => [...prev, ...newParticles]);
    setTimeout(() => {
      setParticles((prev) =>
        prev.filter((p) => !newParticles.some((np) => np.id === p.id)),
      );
    }, 1000);
  }, []);

  const createScorePopup = useCallback((x, y, text, type) => {
    const popupId = `popup-${Date.now()}-${Math.random()}`;
    setScorePopups((prev) => [...prev, { id: popupId, x, y, text, type }]);
    setTimeout(() => {
      setScorePopups((prev) => prev.filter((p) => p.id !== popupId));
    }, 1500);
  }, []);

  const createRipple = useCallback((x, y, color) => {
    const rippleId = `ripple-${Date.now()}-${Math.random()}`;
    setRipples((prev) => [...prev, { id: rippleId, x, y, size: 50, color }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== rippleId));
    }, 1000);
  }, []);

  const createConfetti = useCallback((x, y) => {
    const newConfetti = [];
    const colors = ["#6366f1", "#ec4899", "#10b981", "#f59e0b", "#06b6d4"];
    for (let i = 0; i < 50; i++) {
      const dx = (Math.random() - 0.5) * 200;
      const dy = (Math.random() - 0.5) * 200 - 100;
      const rot = Math.random() * 720;
      newConfetti.push({
        id: `confetti-${Date.now()}-${i}`,
        x: x,
        y: y,
        color: colors[Math.floor(Math.random() * colors.length)],
        "--dx": `${dx}px`,
        "--dy": `${dy}px`,
        "--rot": `${rot}deg`,
        width: Math.random() * 10 + 5,
        height: Math.random() * 10 + 5,
      });
    }
    setConfetti((prev) => [...prev, ...newConfetti]);
    setTimeout(() => {
      setConfetti((prev) =>
        prev.filter((c) => !newConfetti.some((nc) => nc.id === c.id)),
      );
    }, 1500);
  }, []);

  useEffect(() => {
    const { geckosUrl, geckosPort, geckosPath } = getServerConfig();

    const io = geckos({
      url: geckosUrl,
      port: geckosPort,
      ...(geckosPath && { path: geckosPath }),
      iceServers: [
        { urls: "stun:stun.metered.ca:80" },
        {
          urls: "turn:global.relay.metered.ca:443",
          username: "admin",
          credential: "admin",
        },
      ],
    });
    channelRef.current = io;

    const handshakeTimeout = setTimeout(() => {
      if (!connectedRef.current) {
        console.error("[SCREEN] Handshake timeout");
      }
    }, 15000);

    io.onConnect((error) => {
      if (error) {
        console.error("❌ connect error", error);
        clearTimeout(handshakeTimeout);
        return;
      }
      console.log("✅ connected to server");
      connectedRef.current = true;
      setChannel(io);
      io.emit("createRoom");
    });

    io.on("open", () => {
      console.log("🎮 data channel open");
      clearTimeout(handshakeTimeout);
    });

    io.on("roomCreated", (data) => {
      console.log("Room created:", data.roomId);
      setRoomId(data.roomId);
      setJoinToken(data.joinToken);
    });

    io.on("controllerJoined", (data) => {
      console.log("Controller joined:", data.controllerId);
      setControllers([data.controllerId]);
      setScores({ [data.controllerId]: 0 });
      // Reset timer when controller joins
      if (!isGameOver) {
        setTimeLeft(30);
      }
    });

    io.on("controllerLeft", (data) => {
      console.log("Controller left:", data.controllerId);
      setControllers((prev) => prev.filter((id) => id !== data.controllerId));
      setScores((prev) => {
        const newScores = { ...prev };
        delete newScores[data.controllerId];
        return newScores;
      });
    });

    io.on("shoot", (data) => {
      setCrosshair(null);
      handleShoot(data);
    });

    io.on("crosshair", (data) => {
      setCrosshair({ x: data.x, y: data.y, controllerId: data.controllerId });
    });

    io.on("startAiming", (data) => {
      if (data.gyroEnabled) {
        setCrosshair({ x: 50, y: 50, controllerId: data.controllerId });
      } else {
        setCrosshair(null);
      }
    });

    io.on("cancelAiming", () => {
      setCrosshair(null);
      setTargetedOrbId(null);
    });

    io.on("targeting", (data) => {
      setTargetedOrbId(data.orbId);
      if (targetTimeoutRef.current) clearTimeout(targetTimeoutRef.current);
      targetTimeoutRef.current = setTimeout(() => {
        setTargetedOrbId(null);
      }, 500);
    });

    return () => {
      clearTimeout(handshakeTimeout);
      if (connectedRef.current && channelRef.current) {
        try {
          channelRef.current.close();
        } catch (e) {
          // Ignore
        }
      }
      connectedRef.current = false;
    };
  }, [handleShoot, isGameOver]);

  const handleShoot = useCallback(
    (data) => {
      const { controllerId, targetXPercent, targetYPercent, power } = data;
      const id = `shot-${Math.random().toString(36).substr(2, 9)}`;

      setTargetedOrbId(null);

      let targetX = (targetXPercent / 100) * window.innerWidth;
      let targetY = (targetYPercent / 100) * window.innerHeight;

      if (data.isTargetedShot) {
        targetX += 50;
        targetY += 50;
      }

      setProjectiles((prev) => [
        ...prev,
        {
          id,
          x: window.innerWidth / 2,
          y: window.innerHeight,
          targetX,
          targetY,
        },
      ]);

      setTimeout(() => {
        setProjectiles((prev) => prev.filter((p) => p.id !== id));

        const orbElements = document.querySelectorAll(".orb");
        let hitOrb = null;

        orbElements.forEach((orb) => {
          const rect = orb.getBoundingClientRect();
          const orbCenterX = rect.left + rect.width / 2;
          const orbCenterY = rect.top + rect.height / 2;
          const distance = Math.sqrt(
            Math.pow(targetX - orbCenterX, 2) +
              Math.pow(targetY - orbCenterY, 2),
          );

          if (distance < 60) {
            hitOrb = orb.dataset.option;
          }
        });

        if (hitOrb) {
          const isCorrect = hitOrb === question.correct;
          const orbElements = document.querySelectorAll(".orb");
          const isHitOrb = document.querySelector(
            `.orb[data-option="${hitOrb}"]`,
          );
          const orbClass = isCorrect ? "correct-answer" : "wrong-answer";
          const orbRect = isHitOrb.getBoundingClientRect();
          const orbCenterX = orbRect.left + orbRect.width / 2;
          const orbCenterY = orbRect.top + orbRect.height / 2;

          orbElements.forEach((orb) => orb.classList.add(orbClass));
          setTimeout(() => {
            orbElements.forEach((orb) => orb.classList.remove(orbClass));
          }, 1000);

          const color = isCorrect ? "#10b981" : "#ef4444";
          createParticles(orbCenterX, orbCenterY, 20, color);
          createRipple(orbCenterX, orbCenterY, color);

          if (isCorrect) {
            createConfetti(orbCenterX, orbCenterY);
            const points = Math.floor(100 * (1 + timeLeft / 30));
            setScores((prev) => ({
              ...prev,
              [controllerId]: (prev[controllerId] || 0) + points,
            }));
            createScorePopup(orbCenterX, orbCenterY, `+${points}`, "correct");

            if (channelRef.current) {
              channelRef.current.emit("hitResult", {
                controllerId,
                correct: true,
                points,
              });
            }

            // Move to next question after delay
            setTimeout(() => {
              setCurrentQuestion((prev) => prev + 1);
              setTimeLeft(30);
            }, 2000);
          } else {
            createScorePopup(orbCenterX, orbCenterY, "Wrong!", "wrong");

            if (channelRef.current) {
              channelRef.current.emit("hitResult", {
                controllerId,
                correct: false,
                points: 0,
              });
            }
          }
        }
      }, 300);
    },
    [
      question,
      timeLeft,
      createParticles,
      createScorePopup,
      createRipple,
      createConfetti,
    ],
  );

  const handleRestart = () => {
    setIsGameOver(false);
    setFinalScore(0);
    setCurrentQuestion(0);
    setScores({});
    setTimeLeft(30);
  };

  const handleExit = () => {
    setIsGameOver(false);
    setFinalScore(0);
    setCurrentQuestion(0);
    setScores({});
    setControllers([]);
    setRoomId(null);
    setJoinToken(null);
  };

  const controllerUrl =
    roomId && joinToken
      ? `${window.location.origin}/controller/${roomId}/${joinToken}`
      : "";

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
      <div className="screen-container game-over-container">
        <div className="game-over-content">
          <h1 className="game-over-title">⏰ Time's Up!</h1>
          <div className="game-over-score">
            <p className="score-label">Final Score</p>
            <p className="score-value">{finalScore}</p>
          </div>
          <div className="game-over-buttons">
            <button onClick={handleRestart} className="btn btn-restart">
              🔄 Restart Match
            </button>
            <button onClick={handleExit} className="btn btn-exit">
              🚪 Exit
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (controllers.length === 0) {
    return (
      <div className="qr-fullscreen">
        <h1 className="game-title">Code Quiz Wall</h1>

        <div className="qr-content-wrapper">
          <div className="qr-left-column">
            <div className="qr-box-large">
              <QRCodeSVG value={controllerUrl} size={280} level="H" />
              <p className="qr-instruction">Scan to join!</p>
            </div>
          </div>

          <div className="qr-leaderboard">
            <h3>Leaderboard</h3>
            {Object.keys(scores).length === 0 ? (
              <div className="waiting-players">Waiting for players...</div>
            ) : (
              Object.entries(scores)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([id, score], i) => (
                  <div key={id} className="qr-leaderboard-item">
                    <span>#{i + 1} Player</span>
                    <span className="score">{score} pts</span>
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
      <header className="screen-header">
        <div className="timer-display">
          <div className="timer-circle">
            <svg viewBox="0 0 36 36" className="timer-svg">
              <path
                className="timer-bg"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="timer-progress"
                style={{
                  strokeDasharray: `${(timeLeft / 30) * 100}, 100`,
                  stroke: timeLeft <= 10 ? "#ef4444" : "#6366f1",
                }}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="timer-text">
              <span className="time-value">{timeLeft}</span>
              <span className="time-label">sec</span>
            </div>
          </div>
        </div>

        <div className="player-count-badge">
          <span className="player-icon">👥</span>
          <span className="player-count">{controllers.length}</span>
          <div className="score-display">
            <span className="score-label">Score:</span>
            <span className="score-value">
              {Math.max(...Object.values(scores), 0)}
            </span>
          </div>
        </div>
      </header>

      <div className="game-arena" ref={arenaRef}>
        <div className="question-display">
          <div className="question-number">
            Question {currentQuestion + 1} / {QUESTIONS.length}
          </div>
          <p className="question-text">{question.text}</p>
          <pre className="code-block">{question.code}</pre>
        </div>

        {question.options.map((opt, i) => (
          <div
            key={opt.id}
            className={`orb orb-${opt.id.toLowerCase()} ${targetedOrbId === opt.id ? "targeted" : ""}`}
            style={{
              left: ORB_POSITIONS[i].left,
              top: ORB_POSITIONS[i].top,
              animationDelay: `${i * 0.5}s`,
              "--orb-gradient": `linear-gradient(135deg, ${ORB_COLORS[opt.id].split(" ")[0].replace("from-", "")}, ${ORB_COLORS[opt.id].split(" ")[1].replace("to-", "")})`,
              "--orb-glow": ORB_GLOW_COLORS[opt.id],
            }}
            data-option={opt.id}
          >
            <div className="orb-inner">
              <div className="orb-id">{opt.id}</div>
              <div className="orb-text">{opt.text}</div>
            </div>
          </div>
        ))}

        {projectiles.map((p) => (
          <div
            key={p.id}
            className="projectile"
            style={{
              left: p.targetX - 10,
              top: p.targetY - 10,
            }}
          />
        ))}

        {crosshair && (
          <div
            className="crosshair"
            style={{
              left: `${crosshair.x}%`,
              top: `${crosshair.y}%`,
            }}
          >
            <div className="crosshair-line vertical" />
            <div className="crosshair-line horizontal" />
            <div className="crosshair-dot" />
          </div>
        )}

        {hitEffects.map((e) => (
          <div
            key={e.id}
            className={`hit-effect ${e.correct ? "hit-correct" : "hit-wrong"}`}
            style={{
              left: e.x - 75,
              top: e.y - 75,
            }}
          />
        ))}

        {particles.map((p) => (
          <div
            key={p.id}
            className="particle particle-explode"
            style={{
              left: p.x,
              top: p.y,
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              "--tx": p["--tx"],
              "--ty": p["--ty"],
            }}
          />
        ))}

        {scorePopups.map((s) => (
          <div
            key={s.id}
            className={`score-popup ${s.type}`}
            style={{
              left: s.x,
              top: s.y - 50,
            }}
          >
            {s.text}
          </div>
        ))}

        {ripples.map((r) => (
          <div
            key={r.id}
            className="ripple"
            style={{
              left: r.x - r.size / 2,
              top: r.y - r.size / 2,
              width: r.size,
              height: r.size,
              border: `3px solid ${r.color}`,
            }}
          />
        ))}

        {confetti.map((c) => (
          <div
            key={c.id}
            className="confetti"
            style={{
              left: c.x,
              top: c.y,
              width: c.width,
              height: c.height,
              backgroundColor: c.color,
              "--dx": c["--dx"],
              "--dy": c["--dy"],
              "--rot": c["--rot"],
            }}
          />
        ))}
      </div>
    </div>
  );
}
