import React, { useState, useEffect } from 'react';
import { X, Clock, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/components/api';

export default function StudentDetail({ student, isOpen, onClose, sessionToken }) {
    const [quizzes, setQuizzes] = useState([]);
    const [lessons, setLessons] = useState([]);
    const [activeTab, setActiveTab] = useState('quizzes');
    const [loading, setLoading] = useState(false);

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
            setQuizzes(studentEvents.filter(e => e.eventType === 'quiz_attempted').map(e => ({
                quizName: e.contentTitle,
                courseName: e.courseName,
                score: e.score,
                maxScore: e.metadata?.maxScore || 100,
                percentage: e.percentage,
                completedAt: e.occurredAt,
                attemptNumber: e.metadata?.attemptNumber || 1,
                timeSpentSeconds: e.metadata?.timeSpentSeconds || 0,
                source: e.source
            })));

            setLessons(studentEvents.filter(e => e.eventType === 'lesson_completed').map(e => ({
                lessonName: e.contentTitle || 'Course Progress',
                courseName: e.courseName,
                completedAt: e.occurredAt,
                source: e.source
            })));
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

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {student?.firstName} {student?.lastName} - Quiz History
                    </DialogTitle>
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
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Quiz</TableHead>
                                            <TableHead>Course</TableHead>
                                            <TableHead>Attempt</TableHead>
                                            <TableHead>Score</TableHead>
                                            <TableHead>Date & Time</TableHead>
                                            <TableHead>Duration</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {quizzes.map((quiz) => (
                                            <TableRow key={`${quiz.id}-${quiz.attemptNumber}`}>
                                                <TableCell className="font-medium">{quiz.quizName}</TableCell>
                                                <TableCell className="text-sm text-gray-600">{quiz.courseName}</TableCell>
                                                <TableCell className="text-center">{quiz.attemptNumber}</TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <Target className="w-4 h-4 text-gray-400" />
                                                        <span className="font-semibold">{quiz.score}/{quiz.maxScore}</span>
                                                        <span className="text-gray-500">({quiz.percentage}%)</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm">
                                                    {formatDate(quiz.completedAt)}
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        {quiz.source === 'webhook' ? '📡 Live' : '📦 Backfill'}
                                                    </div>
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
                            )
                        ) : (
                            lessons.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    No lessons completed yet
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Lesson</TableHead>
                                            <TableHead>Course</TableHead>
                                            <TableHead>Completed</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {lessons.map((lesson) => (
                                            <TableRow key={lesson.id}>
                                                <TableCell className="font-medium">{lesson.lessonName}</TableCell>
                                                <TableCell className="text-sm text-gray-600">{lesson.courseName}</TableCell>
                                                <TableCell className="text-sm">
                                                    {formatDate(lesson.completedAt)}
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        {lesson.source === 'webhook' ? '📡 Live' : '📦 Backfill'}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}