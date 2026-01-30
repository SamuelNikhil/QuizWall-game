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
  const containerRef = useRef(null);
  const targetTimeoutRef = useRef(null);
  const [particles, setParticles] = useState([]); // Particle effects
  const [scorePopups, setScorePopups] = useState([]); // Score popup animations
  const [ripples, setRipples] = useState([]); // Ripple effects
  const [confetti, setConfetti] = useState([]); // Confetti particles for correct answers
  const [timeLeft, setTimeLeft] = useState(30);
  const [isGameOver, setIsGameOver] = useState(false);
  const timerRef = useRef(null);

  const question = QUESTIONS[currentQuestion % QUESTIONS.length];

  const channelRef = useRef(null);
  const connectedRef = useRef(false);

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

  // Create score popup function
  const createScorePopup = useCallback((x, y, text, type) => {
    const popupId = `popup-${Date.now()}`;
    setScorePopups((prev) => [...prev, { id: popupId, x, y, text, type }]);
    setTimeout(() => {
      setScorePopups((prev) => prev.filter((p) => p.id !== popupId));
    }, 1500);
  }, []);

  // Create ripple effect function
  const createRipple = useCallback((x, y, color) => {
    const rippleId = `ripple-${Date.now()}`;
    setRipples((prev) => [...prev, { id: rippleId, x, y, color, size: 60 }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== rippleId));
    }, 1000);
  }, []);

  // Create confetti function
  const createConfetti = useCallback((x, y) => {
    const newConfetti = [];
    // Material 3 Expressive confetti colors
    const colors = ["#6750A4", "#95d4e4", "#FFD8E4", "#ffffff", "#10b981"];
    for (let i = 0; i < 40; i++) {
      const dx = (Math.random() - 0.5) * 500;
      const dy = -Math.random() * 400 - 150;
      const rot = Math.random() * 1080 - 540;
      newConfetti.push({
        id: `confetti-${Date.now()}-${i}`,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        color: colors[Math.floor(Math.random() * colors.length)],
        "--dx": `${dx}px`,
        "--dy": `${dy}px`,
        "--rot": `${rot}deg`,
        width: Math.random() * 12 + 6,
        height: Math.random() * 12 + 6,
      });
    }
    setConfetti((prev) => [...prev, ...newConfetti]);
    setTimeout(() => {
      setConfetti((prev) =>
        prev.filter((c) => !newConfetti.some((nc) => nc.id === c.id)),
      );
    }, 1800);
  }, []);

  // Ref to store the latest handleShoot function without triggering useEffect reconnections
  const handleShootRef = useRef(null);

  // Define handleShoot
  const handleShoot = useCallback(
    (data) => {
      const { controllerId, targetXPercent, targetYPercent } = data;
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
        {
          id,
          x: window.innerWidth / 2,
          y: window.innerHeight,
          targetX,
          targetY,
        },
      ]);

      // Animate projectile to target
      setTimeout(() => {
        setProjectiles((prev) => prev.filter((p) => p.id !== id));

        if (isGameOver) {
          // Check if shot hit the restart button (Rectangle: bottom center)
          const centerX = window.innerWidth * 0.5;
          const centerY = window.innerHeight * 0.85;
          const btnWidth = 450;
          const btnHeight = 100;

          const isHit =
            targetX >= centerX - btnWidth / 2 &&
            targetX <= centerX + btnWidth / 2 &&
            targetY >= centerY - btnHeight / 2 &&
            targetY <= centerY + btnHeight / 2;

          if (isHit) {
            // Hit the restart button!
            createParticles(targetX, targetY, 30, "#6750A4");
            createRipple(targetX, targetY, "#6750A4");
            createConfetti(targetX, targetY);

            // Reset game state
            setScores({});
            setCurrentQuestion(0);
            setIsGameOver(false);
            setTimeLeft(30);

            // Send restart event to controllers
            if (channelRef.current) {
              channelRef.current.emit("gameRestarted");
            }
          }
        } else {
          // Check collision with orbs
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

            // Add visual animation to ALL orbs
            const orbElements = document.querySelectorAll(".orb");
            orbElements.forEach((orb) => {
              const isHitOrb = orb.dataset.option === hitOrb;
              const orbClass = isCorrect ? "correct-answer" : "wrong-answer";

              // Add animation class to all orbs
              orb.classList.add(orbClass);

              // For the hit orb, we'll make the animation more prominent
              if (isHitOrb) {
                orb.classList.add("hit-orb");
              }
            });

            // Remove animation classes after completion
            setTimeout(() => {
              orbElements.forEach((orb) => {
                orb.classList.remove(
                  "correct-answer",
                  "wrong-answer",
                  "hit-orb",
                );
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

            // Enhanced feedback with particles and popups
            if (isCorrect) {
              // Green particles for correct answer
              createParticles(targetX, targetY, 20, "#10b981");
              // Score popup
              createScorePopup(targetX, targetY, "+100", "correct");
              // Ripple effect
              createRipple(targetX, targetY, "#10b981");
              // Confetti explosion
              createConfetti(targetX, targetY);

              // Update score
              setScores((prev) => ({
                ...prev,
                [controllerId]: (prev[controllerId] || 0) + 100,
              }));

              // Send result back
              if (channelRef.current) {
                channelRef.current.emit("hitResult", {
                  controllerId,
                  correct: true,
                  points: 100,
                });
              }

              // Next question after delay
              setTimeout(() => {
                setCurrentQuestion((prev) => prev + 1);
                setTimeLeft(30); // Reset timer for next question
              }, 1500);
            } else {
              // Red particles for wrong answer
              createParticles(targetX, targetY, 15, "#ef4444");
              // Score popup
              createScorePopup(targetX, targetY, "✗", "wrong");
              // Ripple effect
              createRipple(targetX, targetY, "#ef4444");

              if (channelRef.current) {
                channelRef.current.emit("hitResult", {
                  controllerId,
                  correct: false,
                  points: 0,
                });
              }
            }
          }
        }
      }, 300);
    },
    [
      question,
      createParticles,
      createScorePopup,
      createRipple,
      createConfetti,
      isGameOver,
    ],
  );

  // Update the ref whenever handleShoot changes
  useEffect(() => {
    handleShootRef.current = handleShoot;
  }, [handleShoot]);

  useEffect(() => {
    const { geckosUrl, geckosPort, geckosPath } = getServerConfig();

    // Connect using configured mode (direct or proxy)
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

    // Set timeout to detect hanging handshakes
    const handshakeTimeout = setTimeout(() => {
      if (!connectedRef.current) {
        console.error("[SCREEN] Handshake timeout - possible issues:");
        console.error(
          '  - WebRTC data channel never opened (check for "🎮 data channel open")',
        );
        console.error("  - ICE negotiation failed (network blocking WebRTC)");
        console.error("  - Server not responding to createRoom event");
        console.error("  - CORS or mixed-content issues");
        console.error("  - STUN/TURN servers unreachable");
      }
    }, 15000); // 15 second timeout

    io.onConnect((error) => {
      if (error) {
        console.error("❌ [SCREEN] Connection error:", error);
        clearTimeout(handshakeTimeout);
        return;
      }
      console.log("✅ [SCREEN] Connected to server with ID:", io.id);
      connectedRef.current = true;
      setChannel(io);
      console.log("[SCREEN] Emitting createRoom...");
      io.emit("createRoom");
    });

    io.on("open", () => {
      console.log("🎮 [SCREEN] Data channel open");
      clearTimeout(handshakeTimeout);
    });

    io.on("roomCreated", (data) => {
      console.log("[SCREEN] Room created successfully:", data.roomId);
      console.log("[SCREEN] Join Token:", data.joinToken);
      setRoomId(data.roomId);
      setJoinToken(data.joinToken);
    });

    io.on("controllerJoined", (data) => {
      console.log("Controller joined (Single Player Mode):", data.controllerId);
      // Replace existing controller to ensure only 1 player (handles refreshes/ghosts)
      setControllers([data.controllerId]);
      setScores({ [data.controllerId]: 0 });
    });

    io.on("controllerLeft", (data) => {
      console.log("Controller left:", data.controllerId);
      setControllers((prev) => {
        const newControllers = prev.filter((id) => id !== data.controllerId);
        // Reset game state if last controller leaves
        if (newControllers.length === 0) {
          setIsGameOver(false);
          setScores({});
          setCurrentQuestion(0);
          setTimeLeft(30);
        }
        return newControllers;
      });
      setScores((prev) => {
        const newScores = { ...prev };
        delete newScores[data.controllerId];
        return newScores;
      });
    });

    io.on("shoot", (data) => {
      console.log("[SCREEN] Shoot event received from:", data.controllerId);
      if (handleShootRef.current) {
        handleShootRef.current(data);
      }
    });

    // Crosshair events for gyro aiming
    io.on("crosshair", (data) => {
      setCrosshair({ x: data.x, y: data.y, controllerId: data.controllerId });
    });

    io.on("startAiming", (data) => {
      // Only show crosshair if gyro is enabled on the controller
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

      // Clear existing timeout
      if (targetTimeoutRef.current) clearTimeout(targetTimeoutRef.current);

      // Auto-clear targeted state after 500ms of no updates
      targetTimeoutRef.current = setTimeout(() => {
        setTargetedOrbId(null);
      }, 500);
    });

    io.on("restartGame", () => {
      console.log("🔄 Restarting game...");
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
        } catch (error) {
          // Ignore close errors
          console.log("Error closing channel:", error);
        }
      }
      connectedRef.current = false;
    };
  }, []);

  // Shoot handler is now properly set up

  // Timer effect
  useEffect(() => {
    if (isGameOver || !roomId || controllers.length === 0) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setIsGameOver(true);
          if (channelRef.current) {
            channelRef.current.emit("gameOver", { finalScores: scores });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [roomId, controllers.length, isGameOver, scores]);

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

  if (isGameOver && controllers.length > 0) {
    return (
      <div className="screen-container">
        <div
          className="game-over-screen"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            textAlign: "center",
            animation: "bounceIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)",
            position: "relative",
            scale: "0.8",
          }}
        >
          <h1
            style={{
              fontSize: "5rem",
              fontWeight: "900",
              color: "#ff4444",
              textShadow: "0 0 40px rgba(255, 0, 0, 0.5)",
              marginBottom: "0.5rem",
            }}
          >
            TIME'S UP!
          </h1>
          <div
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              padding: "2.5rem",
              borderRadius: "30px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              backdropFilter: "blur(20px)",
              minWidth: "350px",
              marginBottom: "1.5rem",
            }}
          >
            <h2
              style={{
                fontSize: "1.5rem",
                marginBottom: "0.5rem",
                color: "rgba(255, 255, 255, 0.8)",
                fontWeight: "600",
              }}
            >
              Final Score
            </h2>
            <p
              style={{
                fontSize: "4.5rem",
                fontWeight: "900",
                color: "#90e0ef",
                margin: 0,
              }}
            >
              {Math.max(0, ...Object.values(scores))}
            </p>
          </div>

          <div
            style={{
              marginTop: "1rem",
              padding: "1rem 3rem",
              background: "#6750a4",
              borderRadius: "20px",
              boxShadow: "0 0 30px rgba(103, 80, 164, 0.6)",
              border: "2px solid rgba(255, 255, 255, 0.1)",
              animation: "pulse 2s ease-in-out infinite",
            }}
          >
            <h2
              style={{
                color: "#fff",
                margin: 0,
                fontSize: "1.8rem",
                fontWeight: "900",
                letterSpacing: "1.5px",
              }}
            >
              SHOOT TO RESTART
            </h2>
          </div>

          {/* Crosshair visible during Game Over slinging */}
          {crosshair && (
            <div
              style={{
                position: "absolute",
                left: `${crosshair.x}%`,
                top: `${crosshair.y}%`,
                transform: "translate(-50%, -50%)",
                width: "60px",
                height: "60px",
                border: "3px solid #fff",
                borderRadius: "50%",
                pointerEvents: "none",
                boxShadow: "0 0 20px rgba(255,255,255,0.5)",
                zIndex: 1000,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "0",
                  width: "2px",
                  height: "100%",
                  background: "rgba(255, 255, 255, 0.7)",
                  transform: "translateX(-50%)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "0",
                  height: "2px",
                  width: "100%",
                  background: "rgba(255, 255, 255, 0.7)",
                  transform: "translateY(-50%)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  width: "8px",
                  height: "8px",
                  background: "#ff4444",
                  borderRadius: "50%",
                }}
              />
            </div>
          )}

          {/* Projectiles & Particles visible during Game Over shooting */}
          {projectiles.map((p) => (
            <div
              key={p.id}
              className="projectile"
              style={{
                left: p.targetX - 10,
                top: p.targetY - 10,
                transition: "all 0.3s ease-out",
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
        </div>
      </div>
    );
  }

  if (controllers.length === 0) {
    return (
      <div className="qr-fullscreen">
        <h1
          style={{
            fontSize: "3rem",
            marginBottom: "1rem",
            color: "#fff",
            fontWeight: "900",
            textShadow: "0 0 50px rgba(103, 80, 164, 0.6)",
            textAlign: "center",
            letterSpacing: "-3px",
            lineHeight: "1.1",
            fontFamily: "var(--font-main)",
          }}
        >
          Quiz Wall
        </h1>

        <div className="qr-content-wrapper">
          <div className="qr-left-column" style={{ display: "flex" }}>
            <div className="qr-box-large">
              <QRCodeSVG
                value={controllerUrl}
                size={240}
                level="H"
                fgColor="#1C1B1F"
              />
            </div>
            <p
              style={{
                marginTop: "2rem",
                fontSize: "1.25rem",
                fontWeight: "600",
                opacity: 0.8,
              }}
            >
              Scan to Play 🎯
            </p>
          </div>

          <div className="qr-leaderboard">
            <h3 style={{ fontFamily: "var(--font-main)", fontWeight: "800" }}>
              Leaderboard
            </h3>
            {Object.keys(scores).length === 0 ? (
              <div
                style={{
                  padding: "2rem",
                  textAlign: "center",
                  opacity: 0.6,
                  fontStyle: "italic",
                  fontSize: "1rem",
                }}
              >
                Waiting for challengers...
              </div>
            ) : (
              Object.entries(scores)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([id, score], i) => (
                  <div
                    key={id}
                    className="qr-leaderboard-item"
                    style={{
                      borderRadius: "var(--radius-md)",
                      border:
                        i === 0
                          ? "2px solid var(--accent-primary)"
                          : "1px solid var(--glass-border)",
                      background:
                        i === 0 ? "rgba(103, 80, 164, 0.2)" : "var(--glass-bg)",
                    }}
                  >
                    <span style={{ fontSize: "0.9rem" }}>
                      {i === 0 ? "👑" : `#${i + 1}`} Player
                    </span>
                    <span
                      style={{
                        color: "var(--accent-secondary)",
                        fontWeight: "800",
                        fontSize: "1rem",
                      }}
                    >
                      {score} pts
                    </span>
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
      <header
        className="screen-header"
        style={{ justifyContent: "flex-end", padding: "2rem" }}
      >
        <div className="player-count-badge">
          <span
            style={{
              fontSize: "1.2rem",
              filter: "drop-shadow(0 0 10px rgba(103, 80, 164, 0.5))",
            }}
          >
            👥
          </span>
          <span style={{ fontWeight: "900", color: "var(--text-primary)" }}>
            {controllers.length}
          </span>

          <div
            style={{
              display: "flex",
              gap: "20px",
              borderLeft: "2px solid var(--glass-border)",
              paddingLeft: "20px",
            }}
          >
            {Object.keys(scores).length === 0 ? (
              <span
                style={{ opacity: 0.6, fontSize: "1rem", fontWeight: "600" }}
              >
                Ready for takeoff...
              </span>
            ) : (
              <span
                style={{ display: "flex", alignItems: "center", gap: "10px" }}
              >
                <span
                  style={{
                    color: "var(--accent-secondary)",
                    fontWeight: "800",
                    fontSize: "1.1rem",
                  }}
                >
                  High Score: {Math.max(...Object.values(scores))}
                </span>
              </span>
            )}
          </div>
        </div>
        {/* Timer Bar */}
        <div
          style={{
            position: "absolute",
            top: "0",
            left: "0",
            width: "100%",
            height: "8px",
            background: "rgba(255,255,255,0.1)",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: `${(timeLeft / 30) * 100}%`,
              height: "100%",
              background:
                timeLeft <= 10
                  ? "var(--accent-error)"
                  : "var(--accent-primary)",
              transition: "width 1s linear, background 0.3s ease",
              boxShadow: `0 0 20px ${timeLeft <= 10 ? "var(--accent-error)" : "var(--accent-primary)"}`,
            }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            top: "3rem",
            left: "2rem",
            fontSize: "1.8rem",
            fontWeight: "900",
            color:
              timeLeft <= 10 ? "var(--accent-error)" : "var(--text-primary)",
            zIndex: 1000,
          }}
        >
          {timeLeft}s
        </div>
      </header>

      <div className="game-arena" ref={arenaRef}>
        <div className="question-display">
          <p
            className="question-text"
            style={{
              fontFamily: "var(--font-main)",
              fontWeight: "800",
              color: "#fff",
            }}
          >
            {question.text}
          </p>
          <pre
            className="code-block"
            style={{
              borderRadius: "var(--radius-md)",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid var(--glass-border)",
              color: "var(--accent-secondary)",
              fontWeight: "600",
            }}
          >
            {question.code}
          </pre>
        </div>

        {/* Answer Orbs */}
        {question.options.map((opt, i) => (
          <div
            key={opt.id}
            className={`orb orb-${opt.id.toLowerCase()} ${targetedOrbId === opt.id ? "targeted" : ""}`}
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
              transition: "all 0.3s ease-out",
            }}
          />
        ))}

        {/* Crosshair for gyro aiming */}
        {crosshair && (
          <div
            style={{
              position: "absolute",
              left: `${crosshair.x}%`,
              top: `${crosshair.y}%`,
              transform: "translate(-50%, -50%)",
              width: "60px",
              height: "60px",
              border: "3px solid #fff",
              borderRadius: "50%",
              pointerEvents: "none",
              boxShadow:
                "0 0 20px rgba(255,255,255,0.5), inset 0 0 20px rgba(255,255,255,0.2)",
              zIndex: 1000,
            }}
          >
            {/* Crosshair lines */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "0",
                width: "2px",
                height: "100%",
                background: "rgba(255,255,255,0.7)",
                transform: "translateX(-50%)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "0",
                height: "2px",
                width: "100%",
                background: "rgba(255,255,255,0.7)",
                transform: "translateY(-50%)",
              }}
            />
            {/* Center dot */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: "8px",
                height: "8px",
                background: "#ef4444",
                borderRadius: "50%",
                boxShadow: "0 0 10px #ef4444",
              }}
            />
          </div>
        )}

        {/* Hit Effects */}
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

        {/* Particle Effects */}
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

        {/* Score Popups */}
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

        {/* Ripple Effects */}
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

        {/* Confetti Particles */}
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
