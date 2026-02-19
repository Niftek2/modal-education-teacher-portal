import React, { useState } from 'react';
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { api } from '@/components/api';

function formatDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function AssignmentRow({ assignment }) {
    const done = assignment.status === 'completed';
    const contentLabel = assignment.contentType === 'quiz' ? 'Quiz' : 'Lesson';

    return (
        <div className={`flex items-start gap-3 py-3 px-4 rounded-lg border ${done ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
            <div className="mt-0.5 flex-shrink-0">
                {done
                    ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                    : <Circle className="w-5 h-5 text-gray-300" />
                }
            </div>
            <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium leading-snug ${done ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                    <span className="text-purple-700 no-underline">{contentLabel}:</span>{' '}{assignment.title}
                </p>
                {assignment.topic && (
                    <p className="text-xs text-gray-400 mt-0.5">{assignment.topic}</p>
                )}
                <div className="flex flex-wrap items-center gap-3 mt-1">
                    {assignment.dueAt && !done && (
                        <span className="text-xs text-orange-600">Due {formatDate(assignment.dueAt)}</span>
                    )}
                    {done && assignment.completedAt && (
                        <span className="text-xs text-green-600">Completed {formatDate(assignment.completedAt)}</span>
                    )}
                </div>
            </div>
            {assignment.contentUrl && !done && (
                <a
                    href={assignment.contentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 flex items-center gap-1 text-xs font-medium text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-md border border-purple-200 transition-colors"
                >
                    Start <ExternalLink className="w-3 h-3" />
                </a>
            )}
        </div>
    );
}

export default function StudentAssignmentsPage() {
    const [email, setEmail] = useState('');
    const [assignments, setAssignments] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const normalized = email.trim().toLowerCase();
        if (!normalized || !normalized.includes('@')) {
            setError('Please enter a valid email address.');
            return;
        }
        setLoading(true);
        setError('');
        setAssignments(null);
        try {
            const result = await api.call('getStudentAssignmentsByEmail', { studentEmail: normalized });
            setAssignments(result.assignments || []);
            setSubmitted(true);
        } catch (err) {
            setError(err.message || 'Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Group by status: incomplete first, then completed
    const incomplete = (assignments || []).filter(a => a.status !== 'completed');
    const completed = (assignments || []).filter(a => a.status === 'completed');

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4">
            <div className="w-full max-w-lg">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-bold text-gray-900">My Assignments</h1>
                    <p className="text-sm text-gray-500 mt-1">Enter your email to see your assigned lessons and quizzes.</p>
                </div>

                {/* Email form */}
                <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
                    <input
                        type="email"
                        value={email}
                        onChange={e => { setEmail(e.target.value); setSubmitted(false); setAssignments(null); }}
                        placeholder="your@email.com"
                        className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                        autoComplete="email"
                    />
                    <button
                        type="submit"
                        disabled={loading}
                        className="bg-purple-900 hover:bg-purple-800 text-white text-sm font-medium px-5 py-2.5 rounded-lg disabled:opacity-50 transition-colors"
                    >
                        {loading ? 'Loading…' : 'View'}
                    </button>
                </form>

                {error && (
                    <p className="text-sm text-red-600 mb-4">{error}</p>
                )}

                {/* Results */}
                {submitted && assignments !== null && (
                    <div>
                        {assignments.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-8">No assignments found for this email.</p>
                        ) : (
                            <>
                                {incomplete.length > 0 && (
                                    <div className="mb-6">
                                        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                                            To Do ({incomplete.length})
                                        </h2>
                                        <div className="space-y-2">
                                            {incomplete.map(a => <AssignmentRow key={a.id} assignment={a} />)}
                                        </div>
                                    </div>
                                )}
                                {completed.length > 0 && (
                                    <div>
                                        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                                            Completed ({completed.length})
                                        </h2>
                                        <div className="space-y-2">
                                            {completed.map(a => <AssignmentRow key={a.id} assignment={a} />)}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}