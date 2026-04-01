import React, { useState, useMemo } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { TrendingUp, Award, Users, BarChart2 } from 'lucide-react';

const MASTERY_THRESHOLD = 80;
const MASTERY_CONSECUTIVE = 2;

// ─── helpers ────────────────────────────────────────────────────────────────

function getQuizAttemptsByStudent(events) {
    // returns { [email]: { [quizName]: [{score, date}...] } }
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
    // sort each quiz's attempts by date asc
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
        if (a.score >= MASTERY_THRESHOLD) {
            consecutive++;
            if (consecutive >= MASTERY_CONSECUTIVE) return true;
        } else {
            consecutive = 0;
        }
    }
    return false;
}

function getMasteryDate(attempts) {
    let consecutive = 0;
    for (const a of attempts) {
        if (a.score >= MASTERY_THRESHOLD) {
            consecutive++;
            if (consecutive >= MASTERY_CONSECUTIVE) return a.date;
        } else {
            consecutive = 0;
        }
    }
    return null;
}

function getGrowth(attempts) {
    const scores = attempts.map(a => a.score).filter(s => typeof s === 'number');
    if (scores.length < 2) return null;
    return scores[scores.length - 1] - scores[0];
}

function scoreColor(score) {
    if (score >= 80) return '#16a34a';
    if (score >= 60) return '#d97706';
    return '#dc2626';
}

// ─── sub-components ─────────────────────────────────────────────────────────

function StudentSelector({ students, selected, onChange }) {
    return (
        <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            value={selected || ''}
            onChange={e => onChange(e.target.value || null)}
        >
            <option value="">All Students (class view)</option>
            {students.map(s => (
                <option key={s.email} value={s.email}>
                    {s.firstName} {s.lastName}
                </option>
            ))}
        </select>
    );
}

function TrendCard({ quizName, attempts }) {
    const data = attempts.map((a, i) => ({
        attempt: i + 1,
        score: Math.round(a.score),
        date: new Date(a.date).toLocaleDateString(),
    }));
    const mastered = checkMastery(attempts);
    const growth = getGrowth(attempts);

    return (
        <div className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm">
            <div className="flex items-start justify-between mb-3">
                <div>
                    <p className="font-semibold text-sm text-gray-900 leading-tight">{quizName}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{attempts.length} attempt{attempts.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex gap-2 items-center flex-shrink-0">
                    {mastered && (
                        <span className="flex items-center gap-1 bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                            <Award className="w-3 h-3" /> Mastered
                        </span>
                    )}
                    {growth !== null && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${growth > 0 ? 'bg-blue-100 text-blue-700' : growth < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                            {growth > 0 ? '+' : ''}{Math.round(growth)}%
                        </span>
                    )}
                </div>
            </div>
            {attempts.length > 1 ? (
                <ResponsiveContainer width="100%" height={100}>
                    <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="attempt" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                        <Tooltip
                            formatter={(v) => [`${v}%`, 'Score']}
                            labelFormatter={(l) => `Attempt ${l}`}
                            contentStyle={{ fontSize: 11, borderRadius: 8 }}
                        />
                        <ReferenceLine y={MASTERY_THRESHOLD} stroke="#16a34a" strokeDasharray="4 2" strokeWidth={1} />
                        <Line type="monotone" dataKey="score" stroke="#7c3aed" strokeWidth={2} dot={{ r: 4, fill: '#7c3aed' }} />
                    </LineChart>
                </ResponsiveContainer>
            ) : (
                <div className="flex items-center justify-center h-[100px] text-sm text-gray-400">
                    Score: <span className="font-bold ml-1" style={{ color: scoreColor(attempts[0].score) }}>{Math.round(attempts[0].score)}%</span>
                </div>
            )}
        </div>
    );
}

function ClassGrowthView({ students, quizMap }) {
    // For each quiz that has >= 2 students: show peer comparison bar
    const quizNames = new Set();
    for (const email of Object.keys(quizMap)) {
        for (const quiz of Object.keys(quizMap[email])) {
            quizNames.add(quiz);
        }
    }

    const quizStats = [];
    for (const quiz of quizNames) {
        const growthScores = [];
        const latestScores = [];
        const studentData = [];
        for (const s of students) {
            const attempts = quizMap[s.email]?.[quiz];
            if (!attempts || attempts.length === 0) continue;
            const latest = attempts[attempts.length - 1].score;
            const growth = getGrowth(attempts);
            latestScores.push(latest);
            if (growth !== null) growthScores.push({ name: `${s.firstName} ${s.lastName}`, growth, latest });
            studentData.push({ name: `${s.firstName} ${s.lastName}`, latest, attempts: attempts.length, mastered: checkMastery(attempts) });
        }
        if (studentData.length === 0) continue;
        const avgLatest = latestScores.reduce((a, b) => a + b, 0) / latestScores.length;
        quizStats.push({ quiz, studentData, avgLatest, growthScores });
    }

    // Sort by most students engaged
    quizStats.sort((a, b) => b.studentData.length - a.studentData.length);

    if (quizStats.length === 0) {
        return <p className="text-gray-400 text-sm text-center py-12">No quiz data available for class view.</p>;
    }

    return (
        <div className="space-y-8">
            {quizStats.map(({ quiz, studentData, avgLatest, growthScores }) => (
                <div key={quiz} className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <p className="font-semibold text-gray-900">{quiz}</p>
                        <span className="text-xs text-gray-500">Class avg: <strong>{Math.round(avgLatest)}%</strong></span>
                    </div>
                    <div className="space-y-2">
                        {studentData.sort((a, b) => b.latest - a.latest).map(s => (
                            <div key={s.name} className="flex items-center gap-3">
                                <span className="text-xs text-gray-600 w-28 truncate flex-shrink-0">{s.name}</span>
                                <div className="flex-1 bg-gray-100 rounded-full h-4 relative">
                                    <div
                                        className="h-4 rounded-full transition-all"
                                        style={{ width: `${Math.min(s.latest, 100)}%`, background: scoreColor(s.latest) }}
                                    />
                                    {/* avg line */}
                                    <div
                                        className="absolute top-0 bottom-0 w-0.5 bg-gray-500 opacity-50"
                                        style={{ left: `${avgLatest}%` }}
                                    />
                                </div>
                                <span className="text-xs font-semibold w-10 text-right" style={{ color: scoreColor(s.latest) }}>
                                    {Math.round(s.latest)}%
                                </span>
                                {s.mastered && <Award className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />}
                            </div>
                        ))}
                    </div>
                    {growthScores.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-gray-100">
                            <p className="text-xs text-gray-500 mb-2 font-medium">Growth (first → latest attempt)</p>
                            <div className="flex flex-wrap gap-2">
                                {growthScores.sort((a, b) => b.growth - a.growth).map(s => (
                                    <span key={s.name} className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.growth > 0 ? 'bg-blue-100 text-blue-700' : s.growth < 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                                        {s.name}: {s.growth > 0 ? '+' : ''}{Math.round(s.growth)}%
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// ─── main export ─────────────────────────────────────────────────────────────

export default function GrowthMetrics({ students, events }) {
    const [selectedEmail, setSelectedEmail] = useState(null);

    const quizMap = useMemo(() => getQuizAttemptsByStudent(events || []), [events]);

    // Summary stats
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

    return (
        <div className="space-y-6">
            {/* Summary bar */}
            <div className="grid grid-cols-3 gap-4">
                <div className="border border-gray-200 rounded-xl p-4 bg-white text-center">
                    <TrendingUp className="w-5 h-5 text-purple-700 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-gray-900">{studentsWithGrowth}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Students improving</p>
                </div>
                <div className="border border-gray-200 rounded-xl p-4 bg-white text-center">
                    <Award className="w-5 h-5 text-green-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-gray-900">{totalMasteries}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Mastery achievements</p>
                </div>
                <div className="border border-gray-200 rounded-xl p-4 bg-white text-center">
                    <BarChart2 className="w-5 h-5 text-blue-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-gray-900">{students.length}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Students tracked</p>
                </div>
            </div>

            {/* Selector */}
            <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <StudentSelector students={students} selected={selectedEmail} onChange={setSelectedEmail} />
                {selectedEmail && (
                    <span className="text-xs text-gray-500">
                        {Object.keys(selectedQuizzes).length} quiz{Object.keys(selectedQuizzes).length !== 1 ? 'zes' : ''} attempted
                    </span>
                )}
            </div>

            {/* Content */}
            {selectedEmail ? (
                Object.keys(selectedQuizzes).length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-12">No quiz data yet for {selectedStudent?.firstName}.</p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Object.entries(selectedQuizzes)
                            .sort(([, a], [, b]) => (getGrowth(b) ?? -Infinity) - (getGrowth(a) ?? -Infinity))
                            .map(([quizName, attempts]) => (
                                <TrendCard key={quizName} quizName={quizName} attempts={attempts} />
                            ))}
                    </div>
                )
            ) : (
                <ClassGrowthView students={students} quizMap={quizMap} />
            )}

            <p className="text-xs text-gray-400 text-center">
                Mastery = {MASTERY_THRESHOLD}%+ on {MASTERY_CONSECUTIVE} consecutive attempts · Green dashed line marks mastery threshold
            </p>
        </div>
    );
}