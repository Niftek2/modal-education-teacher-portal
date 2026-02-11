import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Trash2, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

export default function StudentTable({ students, groupId, onStudentRemoved }) {
    const [removing, setRemoving] = useState(null);
    const [showConfirm, setShowConfirm] = useState(null);

    const handleRemove = async (student) => {
        try {
            setRemoving(student.id);
            const sessionToken = localStorage.getItem('modal_math_session');
            
            await base44.functions.invoke('removeStudent', {
                studentId: student.id,
                groupId: groupId
            }, {
                headers: { 'Authorization': `Bearer ${sessionToken}` }
            });

            setShowConfirm(null);
            onStudentRemoved();
        } catch (error) {
            console.error('Remove error:', error);
            alert('Failed to remove student');
        } finally {
            setRemoving(null);
        }
    };

    const getProgressColor = (percentage) => {
        if (percentage >= 75) return 'text-green-700 bg-green-50';
        if (percentage >= 50) return 'text-yellow-700 bg-yellow-50';
        return 'text-red-700 bg-red-50';
    };

    const getProgressIcon = (percentage) => {
        if (percentage >= 50) return <TrendingUp className="w-4 h-4" />;
        if (percentage > 0) return <Minus className="w-4 h-4" />;
        return <TrendingDown className="w-4 h-4" />;
    };

    const formatLastActivity = (date) => {
        if (!date) return 'Never';
        const d = new Date(date);
        const now = new Date();
        const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        return d.toLocaleDateString();
    };

    if (students.length === 0) {
        return (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-12 text-center">
                <p className="text-gray-600 mb-2">No students in this group yet</p>
                <p className="text-sm text-gray-500">Click "Add Students" to get started</p>
            </div>
        );
    }

    return (
        <>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-gray-50 border-b border-gray-200">
                            <TableHead className="font-semibold text-black">Student</TableHead>
                            <TableHead className="font-semibold text-black">Email</TableHead>
                            <TableHead className="font-semibold text-black">Progress</TableHead>
                            <TableHead className="font-semibold text-black">Completed</TableHead>
                            <TableHead className="font-semibold text-black">Last Activity</TableHead>
                            <TableHead className="w-12"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {students.map((student) => (
                            <TableRow key={student.id} className="border-b border-gray-100 hover:bg-gray-50">
                                <TableCell className="font-medium text-black">
                                    {student.firstName} {student.lastName}
                                </TableCell>
                                <TableCell className="text-gray-600 text-sm">
                                    {student.email}
                                </TableCell>
                                <TableCell>
                                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${getProgressColor(student.percentage || 0)}`}>
                                        {getProgressIcon(student.percentage || 0)}
                                        {student.percentage || 0}%
                                    </div>
                                </TableCell>
                                <TableCell className="text-gray-600">
                                    {student.completedLessons || 0} lessons
                                </TableCell>
                                <TableCell className="text-gray-600 text-sm">
                                    {formatLastActivity(student.lastActivity)}
                                </TableCell>
                                <TableCell>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setShowConfirm(student)}
                                        disabled={removing === student.id}
                                        className="text-gray-400 hover:text-red-600"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Confirmation Dialog */}
            <Dialog open={!!showConfirm} onOpenChange={() => setShowConfirm(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-red-600" />
                            Remove Student?
                        </DialogTitle>
                        <DialogDescription>
                            Are you sure you want to remove <strong>{showConfirm?.firstName} {showConfirm?.lastName}</strong> from your group?
                            <br /><br />
                            This will remove their access to the Student bundle and may delete stored progress data.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowConfirm(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => handleRemove(showConfirm)}
                            disabled={removing}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {removing ? 'Removing...' : 'Remove Student'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}