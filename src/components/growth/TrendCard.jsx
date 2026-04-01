import React from 'react';
import { Award } from 'lucide-react';
import { LineChart, Line, YAxis, ResponsiveContainer, ReferenceLine, Tooltip } from 'recharts';
import { motion } from 'framer-motion';

const MASTERY_THRESHOLD = 80;

function scoreColor(score) {
    if (score >= 80) return '#16a34a';
    if (score >= 60) return '#d97706';
    return '#dc2626';
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

export default function TrendCard({ quizName, attempts, onClick, index = 0 }) {
    const data = attempts.map((a, i) => ({ attempt: i + 1, score: Math.round(a.score) }));
    const mastered = checkMastery(attempts);
    const growth = getGrowth(attempts);
    const latest = attempts[attempts.length - 1].score;

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
            whileHover={{ scale: 1.02, boxShadow: '0 4px 20px rgba(99,42,140,0.12)' }}
            onClick={onClick}
            className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm cursor-pointer transition-colors hover:border-purple-200"
        >
            <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-900 leading-tight truncate">{quizName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{attempts.length} attempt{attempts.length !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex gap-1.5 items-center flex-shrink-0 ml-2">
                    {mastered && (
                        <span className="flex items-center gap-1 bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                            <Award className="w-3 h-3" />
                        </span>
                    )}
                    {growth !== null && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${growth > 0 ? 'bg-purple-100 text-purple-700' : growth < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                            {growth > 0 ? '+' : ''}{Math.round(growth)}%
                        </span>
                    )}
                </div>
            </div>

            {attempts.length > 1 ? (
                <ResponsiveContainer width="100%" height={80}>
                    <LineChart data={data} margin={{ top: 2, right: 4, left: -30, bottom: 0 }}>
                        <YAxis domain={[0, 100]} hide />
                        <Tooltip
                            formatter={(v) => [`${v}%`, 'Score']}
                            labelFormatter={(l) => `Attempt ${l}`}
                            contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
                        />
                        <ReferenceLine y={MASTERY_THRESHOLD} stroke="#16a34a" strokeDasharray="4 2" strokeWidth={1} />
                        <Line type="monotone" dataKey="score" stroke="#632a8c" strokeWidth={2} dot={{ r: 3, fill: '#632a8c', stroke: '#fff', strokeWidth: 1.5 }} />
                    </LineChart>
                </ResponsiveContainer>
            ) : (
                <div className="flex items-center justify-center h-[80px]">
                    <span className="text-2xl font-bold" style={{ color: scoreColor(latest) }}>{Math.round(latest)}%</span>
                </div>
            )}
            <p className="text-xs text-center text-gray-400 mt-1">Click for details</p>
        </motion.div>
    );
}