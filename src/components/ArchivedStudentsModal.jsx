import React, { useState, useEffect } from 'react';
import { Archive, X } from 'lucide-react';
import { api } from '@/components/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function ArchivedStudentsModal({ isOpen, onClose, sessionToken }) {
    const [archived, setArchived] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadArchived();
        }
    }, [isOpen]);

    const loadArchived = async () => {
        setLoading(true);
        try {
            const response = await api.call('getArchivedStudents', { sessionToken }, sessionToken);
            setArchived(response.students || []);
        } catch (error) {
            console.error('Failed to load archived students:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleDateString() + ' ' + new Date(dateString).toLocaleTimeString();
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Archive className="w-5 h-5" />
                        Archived Students
                    </DialogTitle>
                </DialogHeader>

                {loading ? (
                    <div className="text-center py-8">
                        <div className="inline-block w-8 h-8 border-4 border-purple-200 border-t-purple-900 rounded-full animate-spin"></div>
                    </div>
                ) : archived.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        No archived students
                    </div>
                ) : (
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-gray-50 border-b border-gray-200">
                                    <TableHead className="font-semibold text-black">Student</TableHead>
                                    <TableHead className="font-semibold text-black">Email</TableHead>
                                    <TableHead className="font-semibold text-black">Archived Date</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {archived.map((student) => (
                                    <TableRow key={student.id} className="border-b border-gray-100">
                                        <TableCell className="font-medium text-black">
                                            {student.studentFirstName} {student.studentLastName}
                                        </TableCell>
                                        <TableCell className="text-gray-600 text-sm">
                                            {student.studentEmail}
                                        </TableCell>
                                        <TableCell className="text-gray-600 text-sm">
                                            {formatDate(student.archivedAt)}
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