import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/components/api';
import { createPageUrl } from '@/utils';

export default function Verify() {
    const [message, setMessage] = useState('Verifying your login...');
    const navigate = useNavigate();

    useEffect(() => {
        const verifyToken = async () => {
            try {
                const params = new URLSearchParams(window.location.search);
                const token = params.get('verify');
                
                console.log('URL search params:', window.location.search);
                console.log('Token extracted:', token);
                
                if (!token) {
                    setMessage('No verification token found. Please check your email link.');
                    setTimeout(() => navigate('/'), 5000);
                    return;
                }

                const response = await api.call('authVerify', { token }, '');
                console.log('authVerify response:', response);
                
                if (response.success && response.sessionToken) {
                    localStorage.setItem('modal_math_session', response.sessionToken);
                    setMessage('Login successful! Redirecting...');
                    setTimeout(() => navigate(createPageUrl('SelectProgram')), 1000);
                } else {
                    console.error('Verification failed:', response);
                    setMessage('Verification failed. Redirecting...');
                    setTimeout(() => navigate('/'), 3000);
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