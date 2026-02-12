import React, { useState } from 'react';
import { Trash2, AlertTriangle, HelpCircle } from 'lucide-react';
import { api } from '@/components/api';
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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';

export default function StudentTable({ students, groupId, onStudentRemoved, sessionToken, onStudentSelected, activities = [] }) {
    const [removing, setRemoving] = useState(null);
    const [showConfirm, setShowConfirm] = useState(null);

    const getLastActive = (email) => {
        const normalizedEmail = email.trim().toLowerCase();
        const studentActivities = activities.filter(a => 
            a.studentEmail?.trim().toLowerCase() === normalizedEmail
        );
        if (studentActivities.length === 0) return null;
        
        const sorted = studentActivities.sort((a, b) => 
            new Date(b.occurredAt) - new Date(a.occurredAt)
        );
        return sorted[0];
    };

    const handleRemove = async (student) => {
        try {
            setRemoving(student.id);
            const sessionToken = localStorage.getItem('modal_math_session');
            
            await api.call('removeStudent', {
                studentId: student.id,
                groupId: groupId,
                sessionToken
            }, sessionToken);

            setShowConfirm(null);
            onStudentRemoved();
        } catch (error) {
            console.error('Remove error:', error);
            alert('Failed to remove student');
        } finally {
            setRemoving(null);
        }
    };

    const formatLastLogin = (date) => {
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
                            <TableHead className="font-semibold text-black">Last Activity</TableHead>
                            <TableHead className="w-12"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {students.map((student) => {
                            const lastActiveEvent = getLastActive(student.email);
                            return (
                            <TableRow 
                                key={student.id} 
                                className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                                onClick={() => onStudentSelected(student)}
                            >
                                <TableCell className="font-medium text-black">
                                    {student.firstName} {student.lastName}
                                </TableCell>
                                <TableCell className="text-gray-600 text-sm">
                                    {student.email}
                                </TableCell>
                                <TableCell className="text-gray-600 text-sm">
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className="flex items-center gap-2">
                                                    <span>{formatLastLogin(lastActiveEvent?.occurredAt)}</span>
                                                    {lastActiveEvent && (
                                                        <HelpCircle className="w-3 h-3 text-gray-400" />
                                                    )}
                                                </div>
                                            </TooltipTrigger>
                                            {lastActiveEvent && (
                                                <TooltipContent side="left" className="text-xs">
                                                    <div className="space-y-1">
                                                        <div><strong>Event:</strong> {lastActiveEvent.eventType}</div>
                                                        <div><strong>Time:</strong> {new Date(lastActiveEvent.occurredAt).toLocaleString()}</div>
                                                        <div><strong>ID:</strong> {lastActiveEvent.rawEventId?.slice(0, 8)}...</div>
                                                    </div>
                                                </TooltipContent>
                                            )}
                                        </Tooltip>
                                    </TooltipProvider>
                                </TableCell>
                                <TableCell>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setShowConfirm(student);
                                        }}
                                        disabled={removing === student.id}
                                        className="text-gray-400 hover:text-red-600"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                            );
                        })}
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