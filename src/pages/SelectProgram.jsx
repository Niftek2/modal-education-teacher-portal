import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function SelectProgram() {
    const navigate = useNavigate();

    useEffect(() => {
        // Check if user is logged in
        const sessionToken = localStorage.getItem('modal_math_session');
        if (!sessionToken) {
            navigate(createPageUrl('Home'));
            return;
        }
    }, [navigate]);

    const handleModalMath = () => {
        navigate(createPageUrl('Dashboard'));
    };

    const handleProfessionalDevelopment = () => {
        window.location.href = 'https://www.modaleducation.com';
    };

    return (
        <div className="min-h-screen bg-white flex items-center justify-center p-6">
            <div className="max-w-md w-full">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-black mb-2">Select Program</h1>
                    <p className="text-lg text-gray-600">Choose where you'd like to go</p>
                </div>

                <div className="space-y-4">
                    <button
                        onClick={handleModalMath}
                        className="w-full bg-purple-900 hover:bg-purple-800 text-white font-semibold py-6 px-6 rounded-2xl transition-colors shadow-sm"
                    >
                        Modal Math
                    </button>

                    <button
                        onClick={handleProfessionalDevelopment}
                        className="w-full bg-gray-100 hover:bg-gray-200 text-black font-semibold py-6 px-6 rounded-2xl transition-colors border border-gray-300"
                    >
                        Modal Education Professional Development
                    </button>
                </div>
            </div>
        </div>
    );
}