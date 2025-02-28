const express = require('express');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const path = require('path');

const app = express();

// Load SSL certificates
const options = {
    key: fs.readFileSync('ssl/key.pem'),  // Path to your private key
    cert: fs.readFileSync('ssl/cert.pem') // Path to your certificate
};

// Create HTTPS server
const server = https.createServer(options, app);
const io = new Server(server);

// Serve static files
app.use(express.static('public'));

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Room management
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join', (roomId) => {
        console.log('User', socket.id, 'joining room:', roomId);
        
        // Join the room
        socket.join(roomId);
        
        const room = rooms.get(roomId) || new Set();
        
        // If room is empty, create it
        if (room.size === 0) {
            rooms.set(roomId, room);
            room.add(socket.id);
            socket.emit('created');
        }
        // If room has one participant, join it
        else if (room.size === 1) {
            room.add(socket.id);
            socket.emit('joined');
            socket.to(roomId).emit('ready');
        }
        // If room is full, reject
        else {
            socket.emit('full');
            return;
        }
        
        // Store room ID in socket for cleanup
        socket.roomId = roomId;
    });

    // Handle WebRTC signaling
    socket.on('offer', ({ roomId, sdp }) => {
        socket.to(roomId).emit('offer', sdp);
    });

    socket.on('answer', ({ roomId, sdp }) => {
        socket.to(roomId).emit('answer', sdp);
    });

    socket.on('ice-candidate', ({ roomId, candidate }) => {
        socket.to(roomId).emit('ice-candidate', { candidate });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        if (socket.roomId) {
            const room = rooms.get(socket.roomId);
            if (room) {
                room.delete(socket.id);
                if (room.size === 0) {
                    rooms.delete(socket.roomId);
                } else {
                    socket.to(socket.roomId).emit('user-disconnected');
                }
            }
        }
    });
});

const PORT = process.env.PORT || 443;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Secure server running at https://0.0.0.0:${PORT}/`);
});
