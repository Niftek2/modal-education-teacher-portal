import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LogIn, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/components/api';

export default function StudentAssignmentsLogin() {
    const [studentEmail, setStudentEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');

        if (!studentEmail) {
            setError('Please enter your email');
            return;
        }

        try {
            setLoading(true);

            const result = await api.call('studentLogin', { studentEmail });

            localStorage.setItem('student_session', result.token);
            localStorage.setItem('student_email', result.studentEmail);

            navigate('/StudentAssignments');
        } catch (err) {
            console.error('Login error:', err);
            setError(err.message || 'Student not found. Please check your email.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-white flex flex-col">
            <main className="flex-1 flex items-center justify-center p-6">
                <div className="max-w-md w-full">
                    <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
                        {/* Logo + Title */}
                        <div className="text-center mb-8">
                            <img
                                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/698c9549de63fc919dec560c/f76ad98a9_LogoNoScript.png"
                                alt="Modal Education"
                                className="h-12 w-12 object-contain mx-auto mb-3"
                            />
                            <h1 className="text-2xl font-bold text-black mb-1">Student Portal</h1>
                            <p className="text-gray-500 text-sm">Sign in to view your assignments</p>
                        </div>

                        {/* Login Form */}
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Your Email
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <Input
                                        type="email"
                                        placeholder="yourname@modalmath.com"
                                        value={studentEmail}
                                        onChange={(e) => setStudentEmail(e.target.value)}
                                        className="pl-10"
                                        disabled={loading}
                                        autoFocus
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                    <p className="text-sm text-red-600">{error}</p>
                                </div>
                            )}

                            <Button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-purple-900 hover:bg-purple-800 text-white"
                            >
                                <LogIn className="w-4 h-4 mr-2" />
                                {loading ? 'Signing in...' : 'Sign In'}
                            </Button>
                        </form>

                        <p className="mt-4 text-xs text-gray-400 text-center">
                            Use your @modalmath.com email provided by your teacher.
                        </p>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="py-4 px-6 text-center border-t border-gray-200 bg-white">
                <p className="text-xs text-gray-400">
                    © 2026 Modal Education.{' '}
                    <Link to="/Home" className="underline hover:text-gray-600">Privacy Policy</Link>
                </p>
            </footer>
        </div>
    );
}