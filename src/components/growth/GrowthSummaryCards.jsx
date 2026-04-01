import React from 'react';
import { TrendingUp, Award, BarChart2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function GrowthSummaryCards({ studentsWithGrowth, totalMasteries, totalStudents }) {
    const cards = [
        { icon: TrendingUp, label: 'Students Improving', value: studentsWithGrowth, color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-100' },
        { icon: Award, label: 'Mastery Achievements', value: totalMasteries, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-100' },
        { icon: BarChart2, label: 'Students Tracked', value: totalStudents, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
    ];

    return (
        <div className="grid grid-cols-3 gap-4">
            {cards.map((card, i) => (
                <motion.div
                    key={card.label}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08 }}
                    className={`border ${card.border} rounded-xl p-4 ${card.bg} text-center`}
                >
                    <card.icon className={`w-5 h-5 ${card.color} mx-auto mb-1`} />
                    <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{card.label}</p>
                </motion.div>
            ))}
        </div>
    );
}