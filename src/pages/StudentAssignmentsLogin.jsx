import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

            const result = await api.call('studentLogin', {
                studentEmail
            });

            // Store session token and email as primary identifier
            localStorage.setItem('student_session', result.token);
            localStorage.setItem('student_email', result.studentEmail);
            localStorage.setItem('modal_math_student_email', result.studentEmail);

            // Navigate to assignments page
            navigate('/StudentAssignments');

        } catch (error) {
            console.error('Login error:', error);
            setError(error.message || 'Student not found. Please check your email.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-white flex items-center justify-center p-6">
            <div className="max-w-md w-full">
                <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 bg-purple-900 rounded-full flex items-center justify-center mx-auto mb-4">
                            <LogIn className="w-8 h-8 text-white" />
                        </div>
                        <h1 className="text-2xl font-bold text-black mb-2">Student Assignments</h1>
                        <p className="text-gray-600 text-sm">
                            Log in to view your assigned work
                        </p>
                    </div>

                    {/* Login Form */}
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Student Email
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <Input
                                    type="email"
                                    placeholder="yourname@modalmath.com"
                                    value={studentEmail}
                                    onChange={(e) => setStudentEmail(e.target.value)}
                                    className="pl-10"
                                    disabled={loading}
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
                            {loading ? 'Logging in...' : 'Log In'}
                        </Button>
                    </form>

                    {/* Help Text */}
                    <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-600 text-center">
                            Use your @modalmath.com email provided by your teacher.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}