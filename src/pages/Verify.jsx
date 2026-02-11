import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';

export default function Verify() {
    const [message, setMessage] = useState('Verifying your login...');
    const navigate = useNavigate();

    useEffect(() => {
        const verifyToken = async () => {
            try {
                const params = new URLSearchParams(window.location.search);
                const token = params.get('verify');
                
                if (!token) {
                    setMessage('No verification token found');
                    setTimeout(() => navigate('/'), 3000);
                    return;
                }

                try {
                    const response = await base44.functions.invoke('authVerify', { token });
                    
                    if (response.data.success && response.data.sessionToken) {
                        localStorage.setItem('modal_math_session', response.data.sessionToken);
                        setMessage('Login successful! Redirecting...');
                        setTimeout(() => navigate('/Dashboard'), 1000);
                    } else {
                        setMessage('Verification failed. Redirecting...');
                        setTimeout(() => navigate('/'), 3000);
                    }
                } catch (innerError) {
                    console.error('Token verification error:', innerError);
                    setMessage('Verification error. Redirecting...');
                    setTimeout(() => navigate('/'), 3000);
                    throw innerError;
                }
            } catch (error) {
                console.error('Verification error:', error);
                setMessage('Verification error. Redirecting...');
                setTimeout(() => navigate('/'), 3000);
            }
        };

        verifyToken();
    }, [navigate]);

    return (
        <div className="min-h-screen bg-white flex items-center justify-center">
            <div className="text-center">
                <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-900 rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-gray-600">{message}</p>
            </div>
        </div>
    );
}