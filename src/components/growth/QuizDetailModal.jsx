import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Award } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { motion } from 'framer-motion';

const MASTERY_THRESHOLD = 80;

function scoreColor(score) {
    if (score >= 80) return '#16a34a';
    if (score >= 60) return '#d97706';
    return '#dc2626';
}

export default function QuizDetailModal({ open, onClose, quizName, studentName, attempts }) {
    if (!attempts) return null;

    const data = attempts.map((a, i) => ({
        attempt: i + 1,
        score: Math.round(a.score),
        date: new Date(a.date).toLocaleDateString(),
    }));

    const best = Math.max(...attempts.map(a => a.score));
    const latest = attempts[attempts.length - 1].score;
    const first = attempts[0].score;
    const growth = latest - first;
    const avg = attempts.reduce((s, a) => s + a.score, 0) / attempts.length;

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-purple-900 pr-6">{quizName}</DialogTitle>
                    {studentName && <p className="text-sm text-gray-500">{studentName}</p>}
                </DialogHeader>

                <div className="grid grid-cols-4 gap-2 my-2">
                    {[
                        { label: 'Best', value: `${Math.round(best)}%`, color: '#16a34a' },
                        { label: 'Latest', value: `${Math.round(latest)}%`, color: scoreColor(latest) },
                        { label: 'Avg', value: `${Math.round(avg)}%`, color: '#7c3aed' },
                        { label: 'Growth', value: `${growth > 0 ? '+' : ''}${Math.round(growth)}%`, color: growth > 0 ? '#2563eb' : growth < 0 ? '#dc2626' : '#6b7280' },
                    ].map(stat => (
                        <motion.div key={stat.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="bg-gray-50 rounded-lg p-2 text-center border border-gray-100">
                            <p className="text-sm font-bold" style={{ color: stat.color }}>{stat.value}</p>
                            <p className="text-xs text-gray-500">{stat.label}</p>
                        </motion.div>
                    ))}
                </div>

                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
                    <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                            <XAxis dataKey="attempt" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                            <Tooltip
                                formatter={(v) => [`${v}%`, 'Score']}
                                labelFormatter={(l) => `Attempt ${l} · ${data[l - 1]?.date || ''}`}
                                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                            />
                            <ReferenceLine y={MASTERY_THRESHOLD} stroke="#16a34a" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: 'Mastery', position: 'right', fontSize: 9, fill: '#16a34a' }} />
                            <Line type="monotone" dataKey="score" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 5, fill: '#7c3aed', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 7 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </motion.div>

                <div className="mt-1 max-h-36 overflow-y-auto space-y-1">
                    {attempts.map((a, i) => (
                        <div key={i} className="flex items-center justify-between text-xs text-gray-600 px-1 py-0.5 rounded hover:bg-gray-50">
                            <span className="text-gray-400">Attempt {i + 1} · {new Date(a.date).toLocaleDateString()}</span>
                            <span className="font-semibold" style={{ color: scoreColor(a.score) }}>{Math.round(a.score)}%</span>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}