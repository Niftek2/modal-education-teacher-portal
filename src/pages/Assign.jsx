import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/components/api';

export default function Assign() {
    const [loading, setLoading] = useState(true);
    const [students, setStudents] = useState([]);
    const [catalog, setCatalog] = useState([]);
    const [selectedStudents, setSelectedStudents] = useState([]);
    const [selectedCatalogId, setSelectedCatalogId] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [existingAssignments, setExistingAssignments] = useState([]);
    const navigate = useNavigate();

    useEffect(() => {
        const sessionToken = localStorage.getItem('modal_math_session');
        if (!sessionToken) {
            navigate('/Home');
            return;
        }
        loadData(sessionToken);
    }, []);

    const loadData = async (sessionToken) => {
        try {
            setLoading(true);

            // Get teacher data (students)
            const teacherData = await api.call('getTeacherData', { sessionToken }, sessionToken);
            
            // Get students from activity (same pattern as dashboard)
            const activityResponse = await api.call('getStudentActivityForTeacher', {
                sessionToken
            }, sessionToken);

            const rosterStudents = activityResponse.studentEmails.map(email => ({
                email,
                firstName: email.split('@')[0],
                lastName: ''
            }));

            setStudents(rosterStudents);

            // Get catalog
            const catalogResponse = await api.call('getAssignmentCatalog', { sessionToken }, sessionToken);
            setCatalog(catalogResponse.catalog || []);

            // Get existing assignments to show completion status
            const assignmentsResponse = await api.call('getTeacherAssignments', { sessionToken }, sessionToken);
            setExistingAssignments(assignmentsResponse.assignments || []);

        } catch (error) {
            console.error('Load error:', error);
            if (error.message?.includes('401')) {
                navigate('/Home');
            }
        } finally {
            setLoading(false);
        }
    };

    const toggleStudent = (email) => {
        setSelectedStudents(prev => 
            prev.includes(email) 
                ? prev.filter(e => e !== email)
                : [...prev, email]
        );
    };

    const toggleAll = () => {
        if (selectedStudents.length === students.length) {
            setSelectedStudents([]);
        } else {
            setSelectedStudents(students.map(s => s.email));
        }
    };

    const handleAssign = async () => {
        if (!selectedCatalogId || selectedStudents.length === 0) {
            alert('Please select students and an assignment');
            return;
        }

        try {
            setSubmitting(true);
            const sessionToken = localStorage.getItem('modal_math_session');

            const result = await api.call('createAssignments', {
                sessionToken,
                studentEmails: selectedStudents,
                catalogId: selectedCatalogId,
                dueAt: dueDate ? new Date(dueDate).toISOString() : null
            }, sessionToken);

            alert(`Successfully assigned to ${result.assigned} student(s)`);
            
            // Reload data
            await loadData(sessionToken);
            
            // Reset form
            setSelectedStudents([]);
            setSelectedCatalogId('');
            setDueDate('');

        } catch (error) {
            console.error('Assignment error:', error);
            alert(error.message || 'Failed to create assignments');
        } finally {
            setSubmitting(false);
        }
    };

    const getStudentAssignmentStats = (studentEmail) => {
        const studentAssignments = existingAssignments.filter(a => a.studentEmail === studentEmail);
        const completed = studentAssignments.filter(a => a.status === 'completed').length;
        const total = studentAssignments.length;
        return { completed, total };
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-900 rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white">
            {/* Header */}
            <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            onClick={() => navigate('/Dashboard')}
                            className="text-gray-600 hover:text-black"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Dashboard
                        </Button>
                        <h1 className="text-2xl font-bold text-black">Assign Work</h1>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-6 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left: Student Selection */}
                    <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-black flex items-center gap-2">
                                <Users className="w-5 h-5" />
                                Select Students
                            </h2>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={toggleAll}
                            >
                                {selectedStudents.length === students.length ? 'Deselect All' : 'Select All'}
                            </Button>
                        </div>

                        <div className="space-y-2 max-h-96 overflow-y-auto">
                            {students.map((student) => {
                                const stats = getStudentAssignmentStats(student.email);
                                return (
                                    <div
                                        key={student.email}
                                        className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:bg-gray-50"
                                    >
                                        <div className="flex items-center gap-3">
                                            <Checkbox
                                                checked={selectedStudents.includes(student.email)}
                                                onCheckedChange={() => toggleStudent(student.email)}
                                            />
                                            <div>
                                                <p className="font-medium text-black">
                                                    {student.firstName} {student.lastName}
                                                </p>
                                                <p className="text-xs text-gray-500">{student.email}</p>
                                            </div>
                                        </div>
                                        {stats.total > 0 && (
                                            <div className="text-xs text-gray-600">
                                                {stats.completed}/{stats.total} completed
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                            <p className="text-sm text-gray-600">
                                {selectedStudents.length} student{selectedStudents.length !== 1 ? 's' : ''} selected
                            </p>
                        </div>
                    </div>

                    {/* Right: Assignment Selection */}
                    <div className="bg-white border border-gray-200 rounded-xl p-6">
                        <h2 className="text-lg font-semibold text-black mb-4">Assignment Details</h2>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Choose Assignment
                                </label>
                                <Select value={selectedCatalogId} onValueChange={setSelectedCatalogId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select an assignment..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {catalog.map((item) => (
                                            <SelectItem key={item.id} value={item.id}>
                                                [{item.level}] {item.title} ({item.type})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Due Date (optional)
                                </label>
                                <Input
                                    type="date"
                                    value={dueDate}
                                    onChange={(e) => setDueDate(e.target.value)}
                                />
                            </div>

                            <Button
                                onClick={handleAssign}
                                disabled={submitting || !selectedCatalogId || selectedStudents.length === 0}
                                className="w-full bg-purple-900 hover:bg-purple-800 text-white"
                            >
                                {submitting ? 'Assigning...' : `Assign to ${selectedStudents.length} Student(s)`}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Recent Assignments Table */}
                <div className="mt-8 bg-white border border-gray-200 rounded-xl p-6">
                    <h2 className="text-lg font-semibold text-black mb-4">Recent Assignments</h2>
                    
                    {existingAssignments.length === 0 ? (
                        <p className="text-gray-500 text-center py-8">No assignments yet</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-200 text-left">
                                        <th className="pb-2 font-semibold text-sm text-gray-700">Student</th>
                                        <th className="pb-2 font-semibold text-sm text-gray-700">Assignment</th>
                                        <th className="pb-2 font-semibold text-sm text-gray-700">Level</th>
                                        <th className="pb-2 font-semibold text-sm text-gray-700">Assigned</th>
                                        <th className="pb-2 font-semibold text-sm text-gray-700">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {existingAssignments.slice(0, 20).map((assignment) => (
                                        <tr key={assignment.id} className="border-b border-gray-100">
                                            <td className="py-3 text-sm text-gray-900">{assignment.studentEmail.split('@')[0]}</td>
                                            <td className="py-3 text-sm text-gray-900">{assignment.title}</td>
                                            <td className="py-3 text-sm text-gray-600">{assignment.level}</td>
                                            <td className="py-3 text-sm text-gray-600">
                                                {new Date(assignment.assignedAt).toLocaleDateString()}
                                            </td>
                                            <td className="py-3">
                                                {assignment.status === 'completed' ? (
                                                    <span className="inline-flex items-center gap-1 text-green-600 text-sm">
                                                        <CheckCircle2 className="w-4 h-4" />
                                                        Completed
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-gray-500 text-sm">
                                                        <Clock className="w-4 h-4" />
                                                        Assigned
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}