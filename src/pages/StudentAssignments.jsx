import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BookOpen, LogOut, ExternalLink, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/components/api';

const COURSE_LEVEL_MAP = {
    '422595': 'PK',
    '422618': 'K',
    '422620': 'L1',
    '496294': 'L2',
    '496295': 'L3',
    '496297': 'L4',
    '496298': 'L5',
};

function resolveLevel(assignment) {
    const fromCourse = assignment.courseId && COURSE_LEVEL_MAP[String(assignment.courseId)];
    return fromCourse || assignment.level || '—';
}

function formatDate(dateString) {
    if (!dateString) return null;
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function StudentAssignments() {
    const [loading, setLoading] = useState(true);
    const [assignments, setAssignments] = useState([]);
    const [studentEmail, setStudentEmail] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const email = localStorage.getItem('student_email');
        if (!email) {
            navigate('/StudentAssignmentsLogin');
            return;
        }
        setStudentEmail(email);
        loadAssignments(email);
    }, []);

    const loadAssignments = async (email) => {
        try {
            setLoading(true);
            const result = await api.call('getStudentAssignments', { studentEmail: email });
            setAssignments(result.assignments || []);
        } catch (error) {
            console.error('Load assignments error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('student_session');
        localStorage.removeItem('student_email');
        navigate('/StudentAssignmentsLogin');
    };

    const pending = assignments.filter(a => a.status === 'assigned');
    const completed = assignments.filter(a => a.status === 'completed');

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-center">
                    <div className="w-10 h-10 border-4 border-purple-200 border-t-purple-900 rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">Loading your assignments...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Header — matches Layout.jsx */}
            <header className="sticky top-0 z-50 bg-gray-100 text-purple-900 shadow-lg">
                <div className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                        <img
                            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/698c9549de63fc919dec560c/f76ad98a9_LogoNoScript.png"
                            alt="Modal Education Logo"
                            className="h-8 w-8 object-contain"
                        />
                        <span className="text-lg" style={{ fontFamily: 'Arial' }}>Modal Education</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-600 hidden sm:block">{studentEmail}</span>
                        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-gray-600 hover:text-black">
                            <LogOut className="w-4 h-4 mr-1.5" /> Sign Out
                        </Button>
                    </div>
                </div>
            </header>

            {/* Content */}
            <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">
                <h1 className="text-2xl font-bold text-black mb-6">My Assignments</h1>

                {assignments.length === 0 ? (
                    <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                        <BookOpen className="w-14 h-14 text-gray-200 mx-auto mb-4" />
                        <h2 className="text-lg font-semibold text-black mb-1">No Assignments Yet</h2>
                        <p className="text-gray-500 text-sm">Your teacher hasn't assigned any work yet. Check back later!</p>
                    </div>
                ) : (
                    <div className="space-y-8">
                        {/* Pending */}
                        {pending.length > 0 && (
                            <section>
                                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                    <Clock className="w-4 h-4" /> Pending ({pending.length})
                                </h2>
                                <div className="space-y-3">
                                    {pending.map(a => <AssignmentCard key={a.id} assignment={a} />)}
                                </div>
                            </section>
                        )}

                        {/* Completed */}
                        {completed.length > 0 && (
                            <section>
                                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                    <CheckCircle2 className="w-4 h-4 text-green-500" /> Completed ({completed.length})
                                </h2>
                                <div className="space-y-3">
                                    {completed.map(a => <AssignmentCard key={a.id} assignment={a} />)}
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </main>

            {/* Footer — matches Layout.jsx */}
            <footer className="py-4 px-6 bg-gray-50 border-t border-gray-200">
                <div className="flex flex-col gap-1">
                    <p className="text-xs text-gray-500">
                        <Link to="/Home" className="underline hover:text-gray-700">Privacy Policy</Link>
                    </p>
                    <p className="text-xs text-gray-500">© 2026 Modal Education. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
}

function AssignmentCard({ assignment }) {
    const isCompleted = assignment.status === 'completed';
    const isOverdue = !isCompleted && assignment.dueAt && new Date(assignment.dueAt) < new Date();
    const level = resolveLevel(assignment);

    return (
        <div className={`bg-white rounded-xl border p-5 flex items-start justify-between gap-4 ${isCompleted ? 'border-green-100' : 'border-gray-200'}`}>
            <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-900">{level}</span>
                    {assignment.type && (
                        <span className="text-xs text-gray-400 uppercase">{assignment.type}</span>
                    )}
                    {isCompleted && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                            <CheckCircle2 className="w-3 h-3" /> Completed
                        </span>
                    )}
                    {isOverdue && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
                            <AlertCircle className="w-3 h-3" /> Overdue
                        </span>
                    )}
                </div>

                {assignment.topic && (
                    <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-0.5">{assignment.topic}</p>
                )}
                <h3 className="text-base font-semibold text-black leading-snug">{assignment.title}</h3>

                <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-400">
                    <span>Assigned {formatDate(assignment.assignedAt)}</span>
                    {assignment.dueAt && (
                        <span className={isOverdue ? 'text-red-500 font-medium' : ''}>
                            Due {formatDate(assignment.dueAt)}
                        </span>
                    )}
                    {assignment.completedAt && (
                        <span className="text-green-600">Done {formatDate(assignment.completedAt)}</span>
                    )}
                    {assignment.metadata?.grade != null && (
                        <span className="text-purple-700 font-medium">Score: {Math.round(assignment.metadata.grade)}%</span>
                    )}
                </div>
            </div>

            <a
                href={assignment.thinkificUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${isCompleted ? 'bg-gray-500 hover:bg-gray-600' : 'bg-purple-900 hover:bg-purple-800'}`}
            >
                <ExternalLink className="w-3.5 h-3.5" />
                {isCompleted ? 'Review' : 'Start'}
            </a>
        </div>
    );
}