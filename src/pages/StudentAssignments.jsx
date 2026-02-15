import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, LogOut, ExternalLink, CheckCircle2, Clock, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/components/api';

export default function StudentAssignments() {
    const [loading, setLoading] = useState(true);
    const [assignments, setAssignments] = useState([]);
    const [studentEmail, setStudentEmail] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const sessionToken = localStorage.getItem('student_session');
        const email = localStorage.getItem('student_email');
        
        if (!sessionToken || !email) {
            navigate('/StudentAssignmentsLogin');
            return;
        }

        setStudentEmail(email);
        loadAssignments(sessionToken);
    }, []);

    const loadAssignments = async (sessionToken) => {
        try {
            setLoading(true);

            const result = await api.call('getStudentAssignments', {
                sessionToken
            });

            setAssignments(result.assignments || []);

        } catch (error) {
            console.error('Load assignments error:', error);
            if (error.message?.includes('401')) {
                localStorage.removeItem('student_session');
                localStorage.removeItem('student_email');
                navigate('/StudentAssignmentsLogin');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('student_session');
        localStorage.removeItem('student_email');
        navigate('/StudentAssignmentsLogin');
    };

    const handleStartAssignment = (url) => {
        window.open(url, '_blank');
    };

    const formatDate = (dateString) => {
        if (!dateString) return null;
        return new Date(dateString).toLocaleDateString();
    };

    const isOverdue = (dueAt) => {
        if (!dueAt) return false;
        return new Date(dueAt) < new Date();
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-900 rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading your assignments...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-white">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-black">My Assignments</h1>
                        <p className="text-sm text-gray-600">{studentEmail.split('@')[0]}</p>
                    </div>
                    <Button
                        onClick={handleLogout}
                        variant="ghost"
                        className="text-gray-600 hover:text-black"
                    >
                        <LogOut className="w-4 h-4 mr-2" />
                        Logout
                    </Button>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-5xl mx-auto px-6 py-8">
                {assignments.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                        <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <h2 className="text-xl font-semibold text-black mb-2">No Assignments Yet</h2>
                        <p className="text-gray-600">
                            Your teacher hasn't assigned any work yet. Check back later!
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {assignments.map((assignment) => {
                            const overdue = isOverdue(assignment.dueAt);
                            
                            return (
                                <div
                                    key={assignment.id}
                                    className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-900">
                                                    {assignment.level}
                                                </span>
                                                <span className="text-xs text-gray-500 uppercase">
                                                    {assignment.type}
                                                </span>
                                                {assignment.status === 'completed' && (
                                                    <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                                                        <CheckCircle2 className="w-3 h-3" />
                                                        Completed
                                                    </span>
                                                )}
                                            </div>

                                            <h3 className="text-lg font-semibold text-black mb-2">
                                                {assignment.title}
                                            </h3>

                                            <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                                                <div className="flex items-center gap-1">
                                                    <Clock className="w-4 h-4" />
                                                    Assigned {formatDate(assignment.assignedAt)}
                                                </div>
                                                {assignment.dueAt && (
                                                    <div className={`flex items-center gap-1 ${overdue && assignment.status !== 'completed' ? 'text-red-600 font-medium' : ''}`}>
                                                        <Calendar className="w-4 h-4" />
                                                        Due {formatDate(assignment.dueAt)}
                                                        {overdue && assignment.status !== 'completed' && ' (Overdue)'}
                                                    </div>
                                                )}
                                                {assignment.completedAt && (
                                                    <div className="flex items-center gap-1 text-green-600">
                                                        <CheckCircle2 className="w-4 h-4" />
                                                        Completed {formatDate(assignment.completedAt)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <Button
                                            onClick={() => handleStartAssignment(assignment.thinkificUrl)}
                                            className={
                                                assignment.status === 'completed'
                                                    ? 'bg-gray-600 hover:bg-gray-700'
                                                    : 'bg-purple-900 hover:bg-purple-800'
                                            }
                                        >
                                            <ExternalLink className="w-4 h-4 mr-2" />
                                            {assignment.status === 'completed' ? 'Review' : 'Start'}
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>
        </div>
    );
}