import React, { useState, useEffect } from 'react';
import { Target, Printer } from 'lucide-react';
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
            console.log(`[StudentDetail] Total events returned: ${events.length}`);
            
            // Filter to this specific student's events by email
            const studentEvents = events.filter(e => e.studentEmail?.toLowerCase() === student.email?.toLowerCase());
            console.log(`[StudentDetail] Filtered to ${studentEvents.length} events for ${student.email}`);
            
            // Split into quizzes and lessons
            const quizAttempts = studentEvents.filter(e => e.eventType === 'quiz_attempted');
            
            // Group by quiz (contentId + title to handle both webhook and CSV records)
            const quizMap = new Map();
            quizAttempts.forEach(e => {
                // Group by contentId if available, otherwise by title
                const groupKey = e.contentId ? String(e.contentId) : (e.contentTitle || 'Unknown').toLowerCase();
                if (!quizMap.has(groupKey)) {
                    quizMap.set(groupKey, []);
                }
                quizMap.get(groupKey).push(e);
            });
            
            const quizList = [];
            quizMap.forEach((eventsInGroup) => {
                // For each quiz, prefer webhook records (2/10/2026 cutoff: anything after uses webhooks with scorePercent)
                const cutoffDate = new Date('2026-02-10T00:00:00Z'); // After 2/10/2026
                const webhookRecords = eventsInGroup.filter(e => {
                    const eventDate = new Date(e.occurredAt);
                    return eventDate >= cutoffDate && Number.isFinite(e.scorePercent);
                });
                
                const csvRecords = eventsInGroup.filter(e => {
                    const eventDate = new Date(e.occurredAt);
                    return eventDate < cutoffDate;
                });
                
                // Use webhook records if available, otherwise CSV records
                const recordsToUse = webhookRecords.length > 0 ? webhookRecords : csvRecords;
                
                recordsToUse.forEach(e => {
                    let percentage = null;
                    if (Number.isFinite(e.scorePercent)) {
                        percentage = Number(e.scorePercent);
                    }
                    
                    const metadata = e.metadata || {};
                    // Use courseName from the event, trim whitespace, and check it's not just empty
                    let courseName = (e.courseName && typeof e.courseName === 'string' && e.courseName.trim()) ? e.courseName.trim() : null;
                    
                    // If no courseName found, try to get it from other quiz attempts in the same group
                    if (!courseName) {
                        const siblingWithCourse = eventsInGroup.find(sibling => sibling.courseName && typeof sibling.courseName === 'string' && sibling.courseName.trim());
                        if (siblingWithCourse) {
                            courseName = siblingWithCourse.courseName.trim();
                        }
                    }
                    
                    courseName = courseName || 'Unknown Course';
                    
                    quizList.push({
                        quizName: e.contentTitle || 'Unknown Quiz',
                        quizId: e.contentId || null,
                        courseName: courseName,
                        level: courseName,
                        percentage: percentage,
                        completedAt: e.occurredAt,
                        attempts: metadata.attemptNumber,
                        correctCount: metadata.correctCount,
                        incorrectCount: metadata.incorrectCount
                    });
                });
            });
            
            console.log(`[StudentDetail] Found ${quizList.length} quiz attempts:`, quizList.slice(0, 3));

            // Group quizzes by quizId or normalized title
            const groupedQuizzes = {};
            quizList.forEach(quiz => {
                const groupKey = quiz.quizId || quiz.quizName.toLowerCase();
                if (!groupedQuizzes[groupKey]) {
                    groupedQuizzes[groupKey] = [];
                }
                groupedQuizzes[groupKey].push(quiz);
            });

            // Build flattened structure with group info
            const flatQuizzes = [];
            Object.values(groupedQuizzes).forEach(group => {
                const sortedGroup = group.sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
                const scores = sortedGroup
                    .map(q => q.percentage)
                    .filter(s => typeof s === 'number' && !Number.isNaN(s));
                const bestScore = scores.length > 0 ? Math.max(...scores) : null;
                const latestAttempt = sortedGroup[sortedGroup.length - 1];
                const latestScore = typeof latestAttempt.percentage === 'number' && !Number.isNaN(latestAttempt.percentage) 
                    ? latestAttempt.percentage 
                    : null;
                
                sortedGroup.forEach((quiz, idx) => {
                    flatQuizzes.push({
                        ...quiz,
                        attemptIndex: idx + 1,
                        groupSize: sortedGroup.length,
                        groupBest: bestScore,
                        groupLatestScore: latestScore,
                        groupLatestDate: latestAttempt.completedAt,
                        isFirstInGroup: idx === 0
                    });
                });
            });

            setQuizzes(flatQuizzes);

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

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString() + ' ' + new Date(dateString).toLocaleTimeString();
    };

    const handlePrint = () => {
        window.print();
    };

    const getSortedQuizzes = () => {
        if (quizSort === 'level') {
            return [...quizzes].sort((a, b) => a.level.localeCompare(b.level));
        }
        // Sort by time: most recent first
        return [...quizzes].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
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
                                    <div className="space-y-3">
                                       {getSortedQuizzes().reduce((groups, quiz, idx) => {
                                           const lastGroup = groups[groups.length - 1];
                                           const groupKey = quiz.quizId || quiz.quizName.toLowerCase();
                                           const lastGroupKey = lastGroup ? (lastGroup.attempts[0].quizId || lastGroup.attempts[0].quizName.toLowerCase()) : null;

                                           if (!lastGroup || groupKey !== lastGroupKey) {
                                               groups.push({ attempts: [quiz] });
                                           } else {
                                               lastGroup.attempts.push(quiz);
                                           }
                                           return groups;
                                       }, []).map((group, groupIdx) => {
                                           // Recalculate group stats from current group
                                           const scores = group.attempts.map(q => q.percentage).filter(s => typeof s === 'number' && !Number.isNaN(s));
                                           const groupBest = scores.length > 0 ? Math.max(...scores) : null;
                                           const sortedByTime = [...group.attempts].sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
                                           const latestAttempt = sortedByTime[sortedByTime.length - 1];
                                           const groupLatestScore = typeof latestAttempt.percentage === 'number' && !Number.isNaN(latestAttempt.percentage) ? latestAttempt.percentage : null;

                                           return (
                                           <div key={groupIdx} className="border border-gray-200 rounded-lg overflow-hidden">
                                               <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                                                   <div className="font-medium text-sm">{group.attempts[0].quizName}</div>
                                                   <div className="text-xs text-gray-600 mt-1">
                                                       Attempts: {group.attempts.length} | Best: {groupBest !== null ? `${Math.round(groupBest)}%` : '—'} | Latest: {groupLatestScore !== null ? `${Math.round(groupLatestScore)}%` : '—'} at {formatDate(latestAttempt.completedAt)}
                                                   </div>
                                               </div>
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow className="bg-white">
                                                            <TableHead className="text-xs">Level</TableHead>
                                                            <TableHead className="text-xs">Attempt</TableHead>
                                                            <TableHead className="text-xs">Score</TableHead>
                                                            <TableHead className="text-xs">Date & Time</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {group.attempts.map((quiz, idx) => {
                                                            const sortedByTime = [...group.attempts].sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
                                                            const attemptIndex = sortedByTime.findIndex(q => q.completedAt === quiz.completedAt) + 1;
                                                            
                                                            return (
                                                            <TableRow key={`${quiz.quizName}-${quiz.completedAt}-${idx}`} className="hover:bg-gray-50">
                                                                <TableCell className="text-sm text-gray-600">{quiz.level}</TableCell>
                                                                <TableCell className="text-center text-sm">{attemptIndex}</TableCell>
                                                                <TableCell>
                                                                    <div className="flex flex-col gap-1">
                                                                        <div className="flex items-center gap-2">
                                                                            <Target className="w-4 h-4 text-gray-400" />
                                                                            <span className="font-semibold text-sm">{quiz.percentage !== null && quiz.percentage !== undefined ? `${Math.round(quiz.percentage)}%` : '—'}</span>
                                                                        </div>
                                                                        {quiz.correctCount !== undefined && quiz.correctCount !== null && (
                                                                            <div className="text-xs text-gray-500">
                                                                                ✓ {quiz.correctCount} {quiz.incorrectCount !== undefined && quiz.incorrectCount !== null && `✗ ${quiz.incorrectCount}`}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="text-sm">
                                                                    {formatDate(quiz.completedAt)}
                                                                </TableCell>
                                                            </TableRow>
                                                            )})}
                                                            </TableBody>
                                                            </Table>
                                                            </div>
                                                            )})}
                                    </div>
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