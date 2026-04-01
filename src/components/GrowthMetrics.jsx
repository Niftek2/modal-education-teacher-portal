import React, { useState, useMemo } from 'react';
import { Users, SlidersHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import GrowthSummaryCards from './growth/GrowthSummaryCards';
import TrendCard from './growth/TrendCard';
import ClassGrowthView from './growth/ClassGrowthView';
import QuizDetailModal from './growth/QuizDetailModal';

const MASTERY_THRESHOLD = 80;

function getQuizAttemptsByStudent(events) {
    const map = {};
    for (const e of events) {
        if ((e.eventType !== 'quiz_attempted' && e.eventType !== 'quiz.attempted')) continue;
        if (typeof e.grade !== 'number') continue;
        const email = e.studentEmail?.toLowerCase().trim();
        const quiz = (e.lessonName || e.contentTitle || 'Unknown Quiz').trim();
        if (!email || !quiz) continue;
        if (!map[email]) map[email] = {};
        if (!map[email][quiz]) map[email][quiz] = [];
        map[email][quiz].push({ score: e.grade, date: e.occurredAt, level: e.level });
    }
    for (const email of Object.keys(map)) {
        for (const quiz of Object.keys(map[email])) {
            map[email][quiz].sort((a, b) => new Date(a.date) - new Date(b.date));
        }
    }
    return map;
}

function checkMastery(attempts) {
    let consecutive = 0;
    for (const a of attempts) {
        if (a.score >= MASTERY_THRESHOLD) { consecutive++; if (consecutive >= 2) return true; }
        else consecutive = 0;
    }
    return false;
}

function getGrowth(attempts) {
    const scores = attempts.map(a => a.score).filter(s => typeof s === 'number');
    if (scores.length < 2) return null;
    return scores[scores.length - 1] - scores[0];
}

export default function GrowthMetrics({ students, events }) {
    const [selectedEmail, setSelectedEmail] = useState(null);
    const [sortBy, setSortBy] = useState('growth');
    const [levelFilter, setLevelFilter] = useState('All');
    const [detailQuiz, setDetailQuiz] = useState(null);

    const quizMap = useMemo(() => getQuizAttemptsByStudent(events || []), [events]);

    const totalMasteries = useMemo(() => {
        let count = 0;
        for (const email of Object.keys(quizMap)) {
            for (const quiz of Object.keys(quizMap[email])) {
                if (checkMastery(quizMap[email][quiz])) count++;
            }
        }
        return count;
    }, [quizMap]);

    const studentsWithGrowth = useMemo(() => {
        return students.filter(s => {
            const quizzes = quizMap[s.email] || {};
            return Object.values(quizzes).some(a => getGrowth(a) !== null && getGrowth(a) > 0);
        }).length;
    }, [students, quizMap]);

    const selectedStudent = selectedEmail ? students.find(s => s.email === selectedEmail) : null;
    const selectedQuizzes = selectedEmail ? quizMap[selectedEmail] || {} : {};

    const studentLevels = useMemo(() => {
        const ls = new Set();
        for (const attempts of Object.values(selectedQuizzes)) {
            for (const a of attempts) { if (a.level) ls.add(a.level); }
        }
        return ['All', ...ls];
    }, [selectedQuizzes]);

    const sortedQuizEntries = useMemo(() => {
        let entries = Object.entries(selectedQuizzes);
        if (levelFilter !== 'All') {
            entries = entries.filter(([, attempts]) => attempts.some(a => a.level === levelFilter));
        }
        entries.sort(([qa, a], [qb, b]) => {
            if (sortBy === 'growth') return (getGrowth(b) ?? -Infinity) - (getGrowth(a) ?? -Infinity);
            if (sortBy === 'score') return b[b.length - 1].score - a[a.length - 1].score;
            if (sortBy === 'recent') return new Date(b[b.length - 1].date) - new Date(a[a.length - 1].date);
            if (sortBy === 'alpha') return qa.localeCompare(qb);
            return 0;
        });
        return entries;
    }, [selectedQuizzes, sortBy, levelFilter]);

    return (
        <div className="space-y-6">
            <GrowthSummaryCards
                studentsWithGrowth={studentsWithGrowth}
                totalMasteries={totalMasteries}
                totalStudents={students.length}
            />

            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <select
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-400 text-gray-700"
                        value={selectedEmail || ''}
                        onChange={e => { setSelectedEmail(e.target.value || null); setLevelFilter('All'); }}
                    >
                        <option value="">All Students (class view)</option>
                        {students.map(s => (
                            <option key={s.email} value={s.email}>
                                {s.firstName} {s.lastName}
                            </option>
                        ))}
                    </select>
                </div>

                <AnimatePresence>
                    {selectedEmail && (
                        <motion.div
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -8 }}
                            className="flex items-center gap-2 flex-wrap"
                        >
                            {studentLevels.length > 1 && (
                                <div className="flex gap-1">
                                    {studentLevels.map(l => (
                                        <button
                                            key={l}
                                            onClick={() => setLevelFilter(l)}
                                            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${levelFilter === l ? 'bg-purple-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                        >
                                            {l}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <div className="flex items-center gap-1.5 ml-1">
                                <SlidersHorizontal className="w-3.5 h-3.5 text-gray-400" />
                                <select
                                    className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-purple-400 text-gray-600"
                                    value={sortBy}
                                    onChange={e => setSortBy(e.target.value)}
                                >
                                    <option value="growth">Sort: Most Growth</option>
                                    <option value="score">Sort: Highest Score</option>
                                    <option value="recent">Sort: Most Recent</option>
                                    <option value="alpha">Sort: A → Z</option>
                                </select>
                            </div>
                            <span className="text-xs text-gray-400">
                                {sortedQuizEntries.length} quiz{sortedQuizEntries.length !== 1 ? 'zes' : ''}
                            </span>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <AnimatePresence mode="wait">
                {selectedEmail ? (
                    sortedQuizEntries.length === 0 ? (
                        <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="text-gray-400 text-sm text-center py-12">
                            No quiz data yet for {selectedStudent?.firstName}.
                        </motion.p>
                    ) : (
                        <motion.div key="individual" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {sortedQuizEntries.map(([quizName, attempts], i) => (
                                <TrendCard key={quizName} quizName={quizName} attempts={attempts} index={i}
                                    onClick={() => setDetailQuiz({ quizName, attempts })} />
                            ))}
                        </motion.div>
                    )
                ) : (
                    <motion.div key="class" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <ClassGrowthView students={students} quizMap={quizMap} />
                    </motion.div>
                )}
            </AnimatePresence>

            <p className="text-xs text-gray-400 text-center">
                Mastery = {MASTERY_THRESHOLD}%+ on 2 consecutive attempts · Green dashed line marks mastery threshold
            </p>

            <QuizDetailModal
                open={!!detailQuiz}
                onClose={() => setDetailQuiz(null)}
                quizName={detailQuiz?.quizName}
                studentName={selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : null}
                attempts={detailQuiz?.attempts}
            />
        </div>
    );
}