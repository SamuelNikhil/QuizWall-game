// Minimal reproduction to test Geckos.io connection
import geckos from '@geckos.io/client';

// Test configuration
const SERVER_IP = '3.108.77.64';
const SERVER_PORT = 3000;

console.log('Starting minimal connection test to:', SERVER_IP, SERVER_PORT);

// Test 1: Basic Geckos connection
async function testGeckosConnection() {
    console.log('Test 1: Geckos.io connection');
    
    const channel = geckos({
        url: `http://${SERVER_IP}`,
        port: SERVER_PORT,
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    });
    
    console.log('Created Geckos channel with options:', {
        url: `http://${SERVER_IP}`,
        port: SERVER_PORT
    });
    
    channel.onConnect((error: Error | undefined) => {
        if (error) {
            console.error('Geckos connection failed:', error);
            console.error('Error type:', typeof error);
            if (error.message) {
                console.error('Error message:', error.message);
            }
        } else {
            console.log('Geckos connected successfully! Channel ID:', channel.id);
            
            // Test sending a message
            channel.on('echo', (data: any) => {
                console.log('Received echo:', data);
            });
            
            setTimeout(() => {
                channel.emit('echo', 'Hello from client');
            }, 1000);
        }
    });
    
    // Set timeout
    setTimeout(() => {
        if (!channel.id) {
            console.error('Geckos connection timed out after 15 seconds');
        }
    }, 15000);
}

// Test 2: Direct HTTP request to signaling endpoint
async function testDirectHttp() {
    console.log('Test 2: Direct HTTP request to signaling endpoint');
    
    try {
        const response = await fetch(`http://${SERVER_IP}:${SERVER_PORT}/.wrtc/v2/connections`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('HTTP Response status:', response.status);
        
        if (response.ok) {
            const data = await response.json();
            console.log('Signaling response received:', data);
        } else {
            console.error('HTTP Error:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('Direct HTTP test failed:', error);
    }
}

// Run tests
console.log('Running connection tests...');
testDirectHttp();
testGeckosConnection();