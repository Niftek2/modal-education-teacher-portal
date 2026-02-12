import React, { useState, useEffect } from 'react';
import { Clock, Target, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/components/api';

export default function StudentDetail({ student, isOpen, onClose, sessionToken }) {
    const [quizzes, setQuizzes] = useState([]);
    const [lessons, setLessons] = useState([]);
    const [activeTab, setActiveTab] = useState('quizzes');
    const [loading, setLoading] = useState(false);
    const [quizSort, setQuizSort] = useState('time');
    const [lessonSort, setLessonSort] = useState('time');

    useEffect(() => {
        if (isOpen && student) {
            loadData();
        }
    }, [isOpen, student]);

    const loadData = async () => {
        setLoading(true);
        try {
            // Use teacher-scoped activity endpoint
            const response = await api.call('getStudentActivityForTeacher', {
                sessionToken
            }, sessionToken);
            
            const events = response.events || [];
            
            // Filter to this specific student's events by email
            const studentEvents = events.filter(e => e.studentEmail?.toLowerCase() === student.email?.toLowerCase());
            
            // Split into quizzes and lessons
            const quizList = studentEvents.filter(e => e.eventType === 'quiz_attempted').map(e => {
                let percentage = e.metadata?.percentage;
                if (!percentage && e.rawPayload) {
                    try {
                        const payload = JSON.parse(e.rawPayload);
                        percentage = payload?.percentage || payload?.score || e.metadata?.grade;
                    } catch {}
                }
                return {
                    quizName: e.contentTitle || 'Unknown Quiz',
                    courseName: e.courseName || 'Unknown Course',
                    level: e.courseName || 'Unknown',
                    score: percentage || 0,
                    maxScore: 100,
                    percentage: percentage || 0,
                    completedAt: e.occurredAt,
                    attemptNumber: 1,
                    timeSpentSeconds: 0,
                    correctCount: e.metadata?.correctCount,
                    incorrectCount: e.metadata?.incorrectCount
                };
            });
            setQuizzes(quizList.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)));

            const lessonEvents = studentEvents
                .filter(e => e.eventType === 'lesson_completed')
                .map(e => ({
                    lessonName: e.contentTitle || 'Unknown Lesson',
                    courseName: e.courseName || 'Unknown Course',
                    completedAt: e.occurredAt,
                    source: e.source
                }))
                .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
            setLessons(lessonEvents);
        } catch (error) {
            console.error('Failed to load data:', error);
            setQuizzes([]);
            setLessons([]);
        } finally {
            setLoading(false);
        }
    };

    const formatTime = (seconds) => {
        if (!seconds) return '-';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString() + ' ' + new Date(dateString).toLocaleTimeString();
    };

    const handlePrint = () => {
        window.print();
    };

    const getSortedQuizzes = () => {
        const sorted = [...quizzes];
        if (quizSort === 'level') {
            return sorted.sort((a, b) => a.level.localeCompare(b.level));
        }
        return sorted.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    };

    const getSortedLessons = () => {
        const sorted = [...lessons];
        if (lessonSort === 'level') {
            return sorted.sort((a, b) => (a.level || '').localeCompare(b.level || ''));
        }
        return sorted.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <div className="flex items-center justify-between">
                        <DialogTitle>
                            {student?.firstName} {student?.lastName} - Activity Report
                        </DialogTitle>
                        <button
                            onClick={handlePrint}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors print:hidden"
                            title="Print report"
                        >
                            <Printer className="w-4 h-4 text-gray-600" />
                        </button>
                    </div>
                </DialogHeader>

                {loading ? (
                    <div className="text-center py-8">
                        <div className="inline-block w-8 h-8 border-4 border-purple-200 border-t-purple-900 rounded-full animate-spin"></div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="flex gap-4 border-b border-gray-200">
                            <button
                                onClick={() => setActiveTab('quizzes')}
                                className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
                                    activeTab === 'quizzes'
                                        ? 'border-purple-900 text-purple-900'
                                        : 'border-transparent text-gray-600 hover:text-gray-900'
                                }`}
                            >
                                Quizzes ({quizzes.length})
                            </button>
                            <button
                                onClick={() => setActiveTab('lessons')}
                                className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
                                    activeTab === 'lessons'
                                        ? 'border-purple-900 text-purple-900'
                                        : 'border-transparent text-gray-600 hover:text-gray-900'
                                }`}
                            >
                                Lessons ({lessons.length})
                            </button>
                        </div>

                        {activeTab === 'quizzes' ? (
                            quizzes.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    No quiz attempts yet
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setQuizSort('time')}
                                            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                                                quizSort === 'time'
                                                    ? 'bg-purple-900 text-white'
                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                            }`}
                                        >
                                            Sort by Time
                                        </button>
                                        <button
                                            onClick={() => setQuizSort('level')}
                                            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                                                quizSort === 'level'
                                                    ? 'bg-purple-900 text-white'
                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                            }`}
                                        >
                                            Sort by Level
                                        </button>
                                    </div>
                                    <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Quiz</TableHead>
                                            <TableHead>Level</TableHead>
                                            <TableHead>Attempt</TableHead>
                                            <TableHead>Score</TableHead>
                                            <TableHead>Date & Time</TableHead>
                                            <TableHead>Duration</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {getSortedQuizzes().map((quiz, idx) => (
                                            <TableRow key={`${quiz.quizName}-${quiz.completedAt}-${idx}`}>
                                                <TableCell className="font-medium">{quiz.quizName}</TableCell>
                                                <TableCell className="text-sm text-gray-600">{quiz.level}</TableCell>
                                                <TableCell className="text-center">{quiz.attemptNumber}</TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-2">
                                                            <Target className="w-4 h-4 text-gray-400" />
                                                            <span className="font-semibold">{Math.round(quiz.percentage)}%</span>
                                                        </div>
                                                        {quiz.correctCount !== undefined && (
                                                            <div className="text-xs text-gray-500">
                                                                ✓ {quiz.correctCount} {quiz.incorrectCount !== undefined && `✗ ${quiz.incorrectCount}`}
                                                            </div>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {formatDate(quiz.completedAt)}
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    <div className="flex items-center gap-1 text-gray-600">
                                                        <Clock className="w-4 h-4" />
                                                        {formatTime(quiz.timeSpentSeconds)}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                                </div>
                            )
                        ) : (
                            lessons.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    No lessons completed yet
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setLessonSort('time')}
                                            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                                                lessonSort === 'time'
                                                    ? 'bg-purple-900 text-white'
                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                            }`}
                                        >
                                            Sort by Time
                                        </button>
                                        <button
                                            onClick={() => setLessonSort('level')}
                                            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                                                lessonSort === 'level'
                                                    ? 'bg-purple-900 text-white'
                                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                            }`}
                                        >
                                            Sort by Level
                                        </button>
                                    </div>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Lesson</TableHead>
                                                <TableHead>Course</TableHead>
                                                <TableHead>Completed</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {getSortedLessons().map((lesson, idx) => (
                                                <TableRow key={`${lesson.lessonName}-${lesson.completedAt}-${idx}`}>
                                                    <TableCell className="font-medium">{lesson.lessonName}</TableCell>
                                                    <TableCell className="text-sm text-gray-600">{lesson.courseName}</TableCell>
                                                    <TableCell className="text-sm">
                                                        {formatDate(lesson.completedAt)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}