import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { Mail, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function Home() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');
    const [verifying, setVerifying] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        // Check if already logged in
        const sessionToken = localStorage.getItem('modal_math_session');
        if (sessionToken) {
            navigate('/Dashboard');
            return;
        }

        // Check for verification token in URL - redirect to Verify page
        const params = new URLSearchParams(window.location.search);
        const token = params.get('verify');
        
        if (token) {
            navigate(`/Verify?verify=${token}`);
        }
    }, [navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const response = await base44.functions.invoke('authRequestLink', { email });
            
            if (response.data.success) {
                setSent(true);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to send login link');
        } finally {
            setLoading(false);
        }
    };

    if (verifying) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-6">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-900 rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-600">Verifying...</p>
                </div>
            </div>
        );
    }

    if (sent) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-6">
                <div className="max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 className="w-8 h-8 text-purple-900" />
                    </div>
                    <h1 className="text-3xl font-semibold text-black mb-3">Check your email</h1>
                    <p className="text-gray-600 mb-6">
                        We've sent a magic link to <span className="font-medium text-black">{email}</span>
                    </p>
                    <p className="text-sm text-gray-500">
                        Click the link in your email to access the portal. The link expires in 15 minutes.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white flex items-center justify-center p-6">
            <div className="max-w-md w-full">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-black mb-2">Modal Education</h1>
                    <p className="text-lg text-gray-600">Teacher Portal</p>
                </div>

                <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
                    <h2 className="text-2xl font-semibold text-black mb-6">Login</h2>
                    
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-black mb-2">
                                Email Address
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="teacher@school.edu"
                                    className="pl-12 h-12 border-gray-300 focus:border-purple-900 focus:ring-purple-900"
                                    required
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                                {error}
                            </div>
                        )}

                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full h-12 bg-purple-900 hover:bg-purple-800 text-white font-medium rounded-lg transition-colors"
                        >
                            {loading ? (
                                'Sending...'
                            ) : (
                                <>
                                    Send Magic Link
                                    <ArrowRight className="ml-2 w-5 h-5" />
                                </>
                            )}
                        </Button>
                    </form>

                    <p className="text-xs text-gray-500 mt-6 text-center">
                        A login link will be sent to your email. Only teachers with an active Classroom bundle can access the portal.
                    </p>
                </div>
            </div>
        </div>
    );
}