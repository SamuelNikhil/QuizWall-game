import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import geckos from '@geckos.io/client';
import { getServerConfig } from '../config/network';

export default function Controller() {
    const { roomId, token } = useParams();
    const navigate = useNavigate();
    const [joinError, setJoinError] = useState(null);
    const [channel, setChannel] = useState(null);
    const [connected, setConnected] = useState(false);
    const [joined, setJoined] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [pullBack, setPullBack] = useState({ x: 0, y: 0 });
    const [power, setPower] = useState(0);
    const [lastResult, setLastResult] = useState(null);
    const [gyroEnabled, setGyroEnabled] = useState(false);
    const [needsGyroPermission, setNeedsGyroPermission] = useState(false);
    const [aimPosition, setAimPosition] = useState({ x: 50, y: 50 });
    const [targetedOrb, setTargetedOrb] = useState(null);
    const [showExitConfirm, setShowExitConfirm] = useState(false);

    const slingshotRef = useRef(null);
    const channelRef = useRef(null);
    const targetedOrbRef = useRef(null);
    const gyroListenerRef = useRef(null);

    // Connection Effect
    useEffect(() => {
        const { geckosUrl, geckosPort, geckosPath } = getServerConfig();
        const io = geckos({
            url: geckosUrl, port: geckosPort, ...(geckosPath && { path: geckosPath }),
            iceServers: [{ urls: 'stun:stun.metered.ca:80' }]
        });
        channelRef.current = io;

        io.onConnect((error) => {
            if (error) return console.error('Connection error:', error);
            setConnected(true); setChannel(io);
            if (roomId && token) io.emit('joinRoom', { roomId, token });
        });

        io.on('joinedRoom', (data) => {
            if (data.success) { setJoined(true); setJoinError(null); }
            else setJoinError(data.error);
        });

        io.on('hitResult', (data) => {
            setLastResult(data);
            if (navigator.vibrate) navigator.vibrate(data.correct ? [50, 50, 50] : [200]);
            setTimeout(() => setLastResult(null), 2000);
        });

        return () => { if (channelRef.current) channelRef.current.close(); };
    }, [roomId, token]);

    // Gyro Aiming
    useEffect(() => {
        if (!isDragging || !gyroEnabled) return;
        const handleOrientation = (event) => {
            const { beta, gamma } = event;
            if (beta === null || gamma === null) return;
            const x = Math.max(0, Math.min(100, 50 + (gamma * 2)));
            const y = Math.max(0, Math.min(100, 50 - ((beta - 45) * 2)));
            setAimPosition({ x, y });
            if (channelRef.current) channelRef.current.emit('crosshair', { x, y }, { reliable: false });
        };
        window.addEventListener('deviceorientation', handleOrientation);
        return () => window.removeEventListener('deviceorientation', handleOrientation);
    }, [isDragging, gyroEnabled]);

    const emitTargeting = useCallback((orbId) => {
        if (channelRef.current) {
            channelRef.current.emit('targeting', { orbId });
        }
    }, []);

    const handleStart = (e) => {
        e.preventDefault();
        setIsDragging(true);
        setPower(0);
        const defaultOrb = 'B';
        setTargetedOrb(defaultOrb);
        targetedOrbRef.current = defaultOrb;
        
        if (channelRef.current) {
            channelRef.current.emit('startAiming', { gyroEnabled });
            if (!gyroEnabled) {
                emitTargeting(defaultOrb);
            }
        }
        if (navigator.vibrate) navigator.vibrate(30);
    };

    const handleMove = (e) => {
        if (!isDragging || !slingshotRef.current) return;
        const rect = slingshotRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const moveEvent = e.touches ? e.touches[0] : e;

        let dx = centerX - moveEvent.clientX;
        let dy = centerY - moveEvent.clientY;
        if (dy > 0) dy = 0;

        const distance = Math.min(Math.sqrt(dx * dx + dy * dy), 100);
        const angle = Math.atan2(dy, dx);
        
        setPullBack({ x: -Math.cos(angle) * distance, y: -Math.sin(angle) * distance });
        setPower(distance);

        if (!gyroEnabled && distance > 10) {
            const shootAngle = Math.atan2(-(-Math.sin(angle) * distance), -(-Math.cos(angle) * distance));
            let deg = (shootAngle * 180 / Math.PI + 360) % 360;
            
            let orbId = 'D';
            if (deg >= 180 && deg < 225) orbId = 'A';
            else if (deg >= 225 && deg < 270) orbId = 'B';
            else if (deg >= 270 && deg < 315) orbId = 'C';

            if (orbId !== targetedOrbRef.current) {
                setTargetedOrb(orbId);
                targetedOrbRef.current = orbId;
                emitTargeting(orbId);
            }
        }
    };

    const handleEnd = () => {
        if (!isDragging) return;
        if (power > 15 && channelRef.current) {
            const orbPositions = { 'A': { x: 15, y: 55 }, 'B': { x: 40, y: 70 }, 'C': { x: 60, y: 55 }, 'D': { x: 80, y: 70 } };
            const targetOrb = targetedOrbRef.current || 'D';
            const shotData = gyroEnabled 
                ? { targetXPercent: aimPosition.x, targetYPercent: aimPosition.y, isTargetedShot: false }
                : { targetXPercent: orbPositions[targetOrb].x, targetYPercent: orbPositions[targetOrb].y, isTargetedShot: true };
            
            channelRef.current.emit('shoot', { ...shotData, controllerId: channelRef.current.id, power: power/100 });
            if (navigator.vibrate) navigator.vibrate(50);
        } else {
            if (channelRef.current) channelRef.current.emit('cancelAiming');
        }
        setIsDragging(false); setPullBack({ x: 0, y: 0 }); setPower(0); 
        setTargetedOrb(null); targetedOrbRef.current = null;
    };

    const handleExit = () => {
        setShowExitConfirm(true);
    };

    const confirmExit = () => {
        if (channelRef.current) channelRef.current.close();
        navigate('/');
    };

    const requestGyroPermission = async () => {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            const res = await DeviceOrientationEvent.requestPermission();
            if (res === 'granted') setGyroEnabled(true);
        } else { setGyroEnabled(true); }
        setNeedsGyroPermission(false);
    };

    if (!connected || !joined) return <div className="controller-container"><div className="waiting-screen"><div className="pulse-ring" /><h2>Connecting...</h2></div></div>;

    if (needsGyroPermission) return (
        <div className="controller-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '2rem' }}>
            <div>
                <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>📱</div>
                <h2>Enable Motion?</h2>
                <button onClick={requestGyroPermission} style={{ background: 'var(--accent-primary)', color: 'white', padding: '1rem 2rem', borderRadius: '12px', border: 'none', fontWeight: 'bold' }}>Enable Gyro</button>
                <button onClick={() => setNeedsGyroPermission(false)} style={{ background: 'none', color: 'gray', marginTop: '1rem', border: 'none' }}>Touch Only</button>
            </div>
        </div>
    );

    if (showExitConfirm) return (
        <div className="controller-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '2rem', background: 'rgba(0,0,0,0.9)' }}>
            <div style={{ background: '#1a1a2e', padding: '2rem', borderRadius: '16px', border: '1px solid var(--glass-border)' }}>
                <h2 style={{ marginBottom: '1rem' }}>Exit Game?</h2>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Are you sure you want to leave?</p>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                    <button onClick={confirmExit} style={{ background: '#ef4444', color: 'white', padding: '0.75rem 1.5rem', borderRadius: '8px', border: 'none', fontWeight: 'bold' }}>Yes, Exit</button>
                    <button onClick={() => setShowExitConfirm(false)} style={{ background: 'transparent', color: 'white', padding: '0.75rem 1.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>Cancel</button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="controller-container" onMouseMove={handleMove} onMouseUp={handleEnd} onTouchMove={handleMove} onTouchEnd={handleEnd} style={{ touchAction: 'none' }}>
            <header className="controller-header">
                <p>Room: {roomId} | {gyroEnabled ? 'Gyro ON' : 'Touch Mode'}</p>
                <button onClick={handleExit} style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid #f87171', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer' }}>Exit</button>
            </header>

            {isDragging && !gyroEnabled && (
                <div style={{ position: 'absolute', top: '15%', width: '100%', textAlign: 'center', zIndex: 50, pointerEvents: 'none' }}>
                    <div className={`selected-orb-indicator orb-${targetedOrb?.toLowerCase()}-highlight`}>
                        <span style={{ fontSize: '3.5rem', fontWeight: '700' }}>{targetedOrb || '?'}</span>
                    </div>
                    <p style={{ color: 'var(--accent-primary)', fontSize: '1.2rem', marginTop: '1rem', fontWeight: 600, textShadow: '0 0 10px rgba(0,0,0,0.8)' }}>
                        Targeting: {targetedOrb}
                    </p>
                </div>
            )}

            <div className="slingshot-area" ref={slingshotRef}>
                <div className="answer-thrower-base">
                    {isDragging && power > 5 && <div className="aim-line" style={{ width: power * 2.5, transform: `rotate(${Math.atan2(pullBack.y, pullBack.x) * (180 / Math.PI) + 180}deg)`, left: '50%', top: '50%' }} />}
                    <div className="answer-thrower-ball" style={{ transform: `translate(${pullBack.x}px, ${pullBack.y}px)`, boxShadow: isDragging ? '0 0 50px var(--quiz-wall-primary)' : 'none' }} onMouseDown={handleStart} onTouchStart={handleStart} />
                </div>
            </div>

            <div className="power-indicator"><div className="power-fill" style={{ width: `${power}%` }} /></div>
        </div>
    );
}
