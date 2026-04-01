import React, { useState, useEffect } from 'react';
import { BookOpen, PlusCircle, XCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/components/api';

const COURSE_LABELS = ['PK', 'K', 'L1', 'L2', 'L3', 'L4', 'L5', 'Classroom'];

export default function StudentEnrollmentPanel({ student, sessionToken }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [enrollments, setEnrollments] = useState(null);
    const [knownCourses, setKnownCourses] = useState({});
    const [actionLoading, setActionLoading] = useState(null);
    const [message, setMessage] = useState(null);

    const showMsg = (text, isError = false) => {
        setMessage({ text, isError });
        setTimeout(() => setMessage(null), 4000);
    };

    const fetchEnrollments = async () => {
        setLoading(true);
        try {
            const res = await api.call('adminManageEnrollments', { action: 'get', studentEmail: student.email }, sessionToken);
            setEnrollments(res.enrollments);
            setKnownCourses(res.knownCourses || {});
        } catch (e) {
            showMsg(e.message, true);
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = () => {
        const next = !open;
        setOpen(next);
        if (next && enrollments === null) fetchEnrollments();
    };

    const handleUnenroll = async (enrollment) => {
        setActionLoading(`unenroll-${enrollment.enrollmentId}`);
        try {
            await api.call('adminManageEnrollments', {
                action: 'unenroll',
                studentEmail: student.email,
                enrollmentId: enrollment.enrollmentId,
            }, sessionToken);
            showMsg(`Unenrolled from ${enrollment.courseName}`);
            await fetchEnrollments();
        } catch (e) {
            showMsg(e.message, true);
        } finally {
            setActionLoading(null);
        }
    };

    const handleEnroll = async (label, courseId) => {
        setActionLoading(`enroll-${courseId}`);
        try {
            await api.call('adminManageEnrollments', {
                action: 'enroll',
                studentEmail: student.email,
                courseId,
            }, sessionToken);
            showMsg(`Enrolled in ${label}`);
            await fetchEnrollments();
        } catch (e) {
            showMsg(e.message, true);
        } finally {
            setActionLoading(null);
        }
    };

    // Which known course IDs are already enrolled (not expired)
    const enrolledCourseIds = new Set(
        (enrollments || [])
            .filter(e => !e.expired || new Date(e.expired) > new Date())
            .map(e => e.courseId)
    );

    const unenrolledKnown = COURSE_LABELS
        .filter(label => knownCourses[label] && !enrolledCourseIds.has(String(knownCourses[label])));

    return (
        <div className="mt-2 border border-gray-100 rounded-lg overflow-hidden">
            <button
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-xs font-medium text-gray-600 transition-colors"
                onClick={handleToggle}
            >
                <span className="flex items-center gap-1.5">
                    <BookOpen className="w-3 h-3" />
                    Course Enrollments
                </span>
                {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {open && (
                <div className="p-3 space-y-2">
                    {message && (
                        <div className={`text-xs px-2 py-1.5 rounded ${message.isError ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                            {message.text}
                        </div>
                    )}

                    {loading ? (
                        <div className="flex justify-center py-3">
                            <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
                        </div>
                    ) : (
                        <>
                            {/* Active enrollments */}
                            {(enrollments || []).length === 0 ? (
                                <p className="text-xs text-gray-400 italic">No enrollments found.</p>
                            ) : (
                                <div className="space-y-1">
                                    {(enrollments || []).map(e => {
                                        const isExpired = e.expired && new Date(e.expired) <= new Date();
                                        const isKnown = COURSE_LABELS.some(l => knownCourses[l] && String(knownCourses[l]) === e.courseId);
                                        return (
                                            <div key={e.enrollmentId} className={`flex items-center justify-between rounded px-2 py-1.5 text-xs ${isExpired ? 'bg-gray-50 opacity-60' : 'bg-white border border-gray-100'}`}>
                                                <div>
                                                    <span className="font-medium text-gray-800">
                                                        {e.label ? `[${e.label}] ` : ''}{e.courseName}
                                                    </span>
                                                    {isExpired && <span className="ml-1.5 text-red-500">(expired)</span>}
                                                    {e.percentageCompleted > 0 && (
                                                        <span className="ml-1.5 text-gray-400">{e.percentageCompleted}%</span>
                                                    )}
                                                </div>
                                                {!isExpired && isKnown && (
                                                    <button
                                                        onClick={() => handleUnenroll(e)}
                                                        disabled={!!actionLoading}
                                                        className="text-red-400 hover:text-red-600 ml-2 flex-shrink-0"
                                                        title="Unenroll"
                                                    >
                                                        {actionLoading === `unenroll-${e.enrollmentId}`
                                                            ? <Loader2 className="w-3 h-3 animate-spin" />
                                                            : <XCircle className="w-3 h-3" />}
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Enroll in missing known courses */}
                            {unenrolledKnown.length > 0 && (
                                <div className="pt-2 border-t border-gray-100">
                                    <p className="text-xs text-gray-400 mb-1.5">Enroll in:</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {unenrolledKnown.map(label => (
                                            <button
                                                key={label}
                                                onClick={() => handleEnroll(label, knownCourses[label])}
                                                disabled={!!actionLoading}
                                                className="flex items-center gap-0.5 text-xs px-2 py-1 rounded-full border border-purple-200 text-purple-700 hover:bg-purple-50 disabled:opacity-50"
                                            >
                                                {actionLoading === `enroll-${knownCourses[label]}`
                                                    ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                                    : <PlusCircle className="w-2.5 h-2.5" />}
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}