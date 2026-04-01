import React, { useState, useMemo } from 'react';
import { Award, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function scoreColor(score) {
    if (score >= 80) return '#16a34a';
    if (score >= 60) return '#d97706';
    return '#dc2626';
}

function checkMastery(attempts) {
    let consecutive = 0;
    for (const a of attempts) {
        if (a.score >= 80) { consecutive++; if (consecutive >= 2) return true; }
        else consecutive = 0;
    }
    return false;
}

function getGrowth(attempts) {
    const scores = attempts.map(a => a.score).filter(s => typeof s === 'number');
    if (scores.length < 2) return null;
    return scores[scores.length - 1] - scores[0];
}

function QuizCard({ quiz, studentData, avgLatest, growthScores, compareStudents }) {
    const [expanded, setExpanded] = useState(false);

    // Filter to only comparison students if any selected
    const displayData = compareStudents.length > 0
        ? studentData.filter(s => compareStudents.includes(s.name))
        : studentData;

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden"
        >
            <button
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                onClick={() => setExpanded(e => !e)}
            >
                <div className="flex items-center gap-3">
                    <p className="font-semibold text-gray-900 text-sm text-left">{quiz}</p>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{studentData.length} students</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">Class avg: <strong className="text-purple-700">{Math.round(avgLatest)}%</strong></span>
                    {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
            </button>

            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-5 pb-5 space-y-2.5 border-t border-gray-100 pt-4">
                            {displayData.sort((a, b) => b.latest - a.latest).map((s, i) => (
                                <motion.div
                                    key={s.name}
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.04 }}
                                    className="flex items-center gap-3"
                                >
                                    <span className="text-xs text-gray-600 w-28 truncate flex-shrink-0">{s.name}</span>
                                    <div className="flex-1 bg-gray-100 rounded-full h-4 relative">
                                        <motion.div
                                            className="h-4 rounded-full"
                                            initial={{ width: 0 }}
                                            animate={{ width: `${Math.min(s.latest, 100)}%` }}
                                            transition={{ duration: 0.5, delay: i * 0.04 }}
                                            style={{ background: scoreColor(s.latest) }}
                                        />
                                        <div className="absolute top-0 bottom-0 w-0.5 bg-gray-400 opacity-40" style={{ left: `${avgLatest}%` }} />
                                    </div>
                                    <span className="text-xs font-semibold w-10 text-right" style={{ color: scoreColor(s.latest) }}>
                                        {Math.round(s.latest)}%
                                    </span>
                                    {s.mastered && <Award className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />}
                                </motion.div>
                            ))}

                            {growthScores.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-100">
                                    <p className="text-xs text-gray-400 mb-2 font-medium">Growth (first → latest)</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {growthScores
                                            .filter(s => compareStudents.length === 0 || compareStudents.includes(s.name))
                                            .sort((a, b) => b.growth - a.growth)
                                            .map(s => (
                                                <span key={s.name} className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.growth > 0 ? 'bg-purple-100 text-purple-700' : s.growth < 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                                                    {s.name}: {s.growth > 0 ? '+' : ''}{Math.round(s.growth)}%
                                                </span>
                                            ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

export default function ClassGrowthView({ students, quizMap }) {
    const [compareStudents, setCompareStudents] = useState([]);
    const [levelFilter, setLevelFilter] = useState('All');

    const quizStats = useMemo(() => {
        const quizNames = new Set();
        for (const email of Object.keys(quizMap)) {
            for (const quiz of Object.keys(quizMap[email])) quizNames.add(quiz);
        }
        const stats = [];
        for (const quiz of quizNames) {
            const growthScores = [];
            const latestScores = [];
            const studentData = [];
            let level = 'Unknown';
            for (const s of students) {
                const attempts = quizMap[s.email]?.[quiz];
                if (!attempts || attempts.length === 0) continue;
                const latest = attempts[attempts.length - 1].score;
                const growth = getGrowth(attempts);
                if (attempts[0].level) level = attempts[0].level;
                latestScores.push(latest);
                if (growth !== null) growthScores.push({ name: `${s.firstName} ${s.lastName}`, growth, latest });
                studentData.push({ name: `${s.firstName} ${s.lastName}`, latest, attempts: attempts.length, mastered: checkMastery(attempts) });
            }
            if (studentData.length === 0) continue;
            const avgLatest = latestScores.reduce((a, b) => a + b, 0) / latestScores.length;
            stats.push({ quiz, studentData, avgLatest, growthScores, level });
        }
        return stats.sort((a, b) => b.studentData.length - a.studentData.length);
    }, [students, quizMap]);

    const levels = useMemo(() => {
        const ls = new Set(quizStats.map(q => q.level).filter(Boolean));
        return ['All', ...ls];
    }, [quizStats]);

    const filteredStats = levelFilter === 'All' ? quizStats : quizStats.filter(q => q.level === levelFilter);

    const allNames = useMemo(() => students.map(s => `${s.firstName} ${s.lastName}`), [students]);

    const toggleCompare = (name) => {
        setCompareStudents(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
    };

    if (quizStats.length === 0) {
        return <p className="text-gray-400 text-sm text-center py-12">No quiz data available for class view.</p>;
    }

    return (
        <div className="space-y-4">
            {/* Controls */}
            <div className="flex flex-wrap gap-3 items-center">
                {/* Level filter */}
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 font-medium">Level:</span>
                    <div className="flex gap-1 flex-wrap">
                        {levels.map(l => (
                            <button
                                key={l}
                                onClick={() => setLevelFilter(l)}
                                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${levelFilter === l ? 'bg-purple-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                            >
                                {l}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Compare students */}
                {allNames.length > 0 && (
                    <div className="flex items-center gap-2 ml-auto">
                        <span className="text-xs text-gray-500 font-medium">Compare:</span>
                        <div className="flex gap-1 flex-wrap max-w-xs">
                            {allNames.map(name => (
                                <button
                                    key={name}
                                    onClick={() => toggleCompare(name)}
                                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${compareStudents.includes(name) ? 'bg-purple-700 text-white border-purple-700' : 'border-gray-300 text-gray-500 hover:border-purple-400 hover:text-purple-600'}`}
                                >
                                    {name.split(' ')[0]}
                                </button>
                            ))}
                            {compareStudents.length > 0 && (
                                <button onClick={() => setCompareStudents([])} className="text-xs px-2 py-0.5 rounded-full border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {filteredStats.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">No quizzes at this level.</p>
            ) : (
                <div className="space-y-3">
                    {filteredStats.map(q => (
                        <QuizCard
                            key={q.quiz}
                            {...q}
                            compareStudents={compareStudents}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}