// Network test utility to check connectivity to the server
async function testNetwork() {
    const serverUrl = 'http://3.108.77.64';
    const port = 3000;
    const signalingPath = '/.wrtc/v2/connections';
    
    console.log('Testing network connectivity to:', serverUrl);
    
    try {
        // Test basic HTTP connectivity
        const testUrl = `${serverUrl}:${port}${signalingPath}`;
        console.log('Testing signaling endpoint:', testUrl);
        
        const response = await fetch(testUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('HTTP Response status:', response.status);
        console.log('HTTP Response headers:', [...response.headers.entries()]);
        
        if (response.ok) {
            const data = await response.json();
            console.log('Signaling response:', data);
        } else {
            console.error('HTTP Error:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('Network test failed:', error);
        console.error('Error type:', typeof error);
        if (error instanceof Error) {
            console.error('Error message:', error.message);
        }
    }
    
    // Test DNS resolution
    try {
        console.log('Testing DNS resolution for:', serverUrl);
        const url = new URL(serverUrl);
        console.log('Hostname:', url.hostname);
    } catch (error) {
        console.error('DNS test failed:', error);
    }
}

// Run the test
testNetwork();