// Minimal test file to check Geckos.io connection
import geckos from '@geckos.io/client';

async function testConnection() {
    console.log('Testing connection to:', 'http://3.108.77.64:3000');
    
    const io = geckos({
        url: 'http://3.108.77.64',
        port: 3000,
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    });

    io.onConnect((error) => {
        if (error) {
            console.error('Connection failed:', error);
        } else {
            console.log('Connected successfully!');
            // Test sending a simple message
            io.on('ping', (data) => {
                console.log('Received ping:', data);
            });
            
            // Send a test message after 1 second
            setTimeout(() => {
                io.emit('ping', 'Hello from client');
            }, 1000);
        }
    });

    // Set a timeout for connection
    setTimeout(() => {
        if (!io.id) {
            console.error('Connection timed out after 10 seconds');
        }
    }, 10000);
}

// Run the test
testConnection();