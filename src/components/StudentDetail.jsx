import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Clock, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function StudentDetail({ student, isOpen, onClose, sessionToken }) {
    const [quizzes, setQuizzes] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && student) {
            loadQuizData();
        }
    }, [isOpen, student]);

    const loadQuizData = async () => {
        setLoading(true);
        try {
            const response = await base44.functions.invoke('getStudentQuizzes', {
                studentId: student.id,
                sessionToken: sessionToken
            });
            setQuizzes(response.data.quizzes || []);
        } catch (error) {
            console.error('Failed to load quiz data:', error);
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
                ) : quizzes.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        No quiz attempts yet
                    </div>
                ) : (
                    <div className="space-y-6">
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
                                    <TableRow key={`${quiz.id}-${quiz.attempt}`}>
                                        <TableCell className="font-medium">{quiz.quizTitle}</TableCell>
                                        <TableCell className="text-sm text-gray-600">{quiz.courseTitle}</TableCell>
                                        <TableCell className="text-center">{quiz.attempt}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Target className="w-4 h-4 text-gray-400" />
                                                <span className="font-semibold">{quiz.score}/{quiz.maxScore}</span>
                                                <span className="text-gray-500">({quiz.percentage}%)</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm">{formatDate(quiz.completedAt)}</TableCell>
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
                )}
            </DialogContent>
        </Dialog>
    );
}