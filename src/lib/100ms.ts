import jwt from 'jsonwebtoken';
// 1. REPLACED uuid IMPORT WITH NATIVE crypto
import crypto from 'crypto'; 
import axios from 'axios';

const HMS_ACCESS_KEY = process.env.HMS_ACCESS_KEY || '';
const HMS_SECRET = process.env.HMS_SECRET || '';

// 1. Generate a Management Token (Different from Client Auth Token)
const getManagementToken = () => {
    const payload = {
        access_key: HMS_ACCESS_KEY,
        type: 'management',
        version: 2,
        // 2. REPLACED uuidv4() WITH crypto.randomUUID()
        jti: crypto.randomUUID(),
        iat: Math.floor(Date.now() / 1000),
        nbf: Math.floor(Date.now() / 1000)
    };

    return jwt.sign(payload, HMS_SECRET, {
        algorithm: 'HS256',
        expiresIn: '24h',
    });
};

// 2. Programmatically Create a Room
export const createHmsRoom = async (roomName: string): Promise<string> => {
    try {
        const token = getManagementToken();
        
        const response = await axios.post(
            'https://api.100ms.live/v2/rooms',
            {
                name: roomName,
                description: `Persistent room for ${roomName}`,
                template_id: '684d947e612b61' // Your template ID from your dashboard dump
            },
            {
                headers: { Authorization: `Bearer ${token}` }
            }
        );

        // This is the persistent Room ID you will save to your database!
        return response.data.id; 
    } catch (error) {
        console.error('Failed to create HMS Room:', error);
        throw new Error('Room creation failed');
    }
};