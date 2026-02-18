import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, CheckCircle2, Clock, Search, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { api } from '@/components/api';

const COURSE_LEVEL_MAP = {
    '422595': 'PK',
    '422618': 'K',
    '422620': 'L1',
    '496294': 'L2',
    '496295': 'L3',
    '496297': 'L4',
    '496298': 'L5',
};

const LEVEL_ORDER = ['PK', 'K', 'L1', 'L2', 'L3', 'L4', 'L5'];

function resolveLevel(item) {
    const fromCourse = item.courseId && COURSE_LEVEL_MAP[String(item.courseId)];
    return fromCourse || item.level || '—';
}

function groupCatalogByLevel(catalog) {
    const grouped = {};
    for (const level of LEVEL_ORDER) {
        grouped[level] = [];
    }
    grouped['Other'] = [];

    for (const item of catalog) {
        const level = resolveLevel(item);
        if (grouped[level] !== undefined) {
            grouped[level].push(item);
        } else {
            grouped['Other'].push(item);
        }
    }
    return grouped;
}

export default function Assign() {
    const [loading, setLoading] = useState(true);
    const [students, setStudents] = useState([]);
    const [catalog, setCatalog] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedStudents, setSelectedStudents] = useState([]);
    const [selectedAssignmentIds, setSelectedAssignmentIds] = useState([]);
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

            const [activityResponse, catalogResponse, assignmentsResponse] = await Promise.all([
                api.call('getStudentActivityForTeacher', { sessionToken }, sessionToken),
                api.call('getAssignmentCatalog', { sessionToken }, sessionToken),
                api.call('getTeacherAssignments', { sessionToken }, sessionToken),
            ]);

            const rosterStudents = activityResponse.studentEmails.map(email => ({
                email,
                firstName: email.split('@')[0],
            }));
            setStudents(rosterStudents);

            // Filter out [TEST] entries
            const catalogData = (catalogResponse.catalog || []).filter(item =>
                !item.title?.startsWith('[TEST]') && !item.level?.startsWith('[TEST]')
            );
            setCatalog(catalogData);
            setExistingAssignments(assignmentsResponse.assignments || []);
        } catch (error) {
            console.error('Load error:', error);
            if (error.message?.includes('401')) navigate('/Home');
        } finally {
            setLoading(false);
        }
    };

    const toggleStudent = (email) => {
        setSelectedStudents(prev =>
            prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]
        );
    };

    const toggleAllStudents = () => {
        setSelectedStudents(prev =>
            prev.length === students.length ? [] : students.map(s => s.email)
        );
    };

    const toggleAssignment = (id) => {
        setSelectedAssignmentIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const filteredCatalog = searchTerm
        ? catalog.filter(item =>
            item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            resolveLevel(item).toLowerCase().includes(searchTerm.toLowerCase())
          )
        : catalog;

    const grouped = groupCatalogByLevel(filteredCatalog);

    const handleAssign = async () => {
        if (selectedAssignmentIds.length === 0 || selectedStudents.length === 0) {
            alert('Please select at least one student and one assignment.');
            return;
        }
        try {
            setSubmitting(true);
            const sessionToken = localStorage.getItem('modal_math_session');

            const calls = [];
            for (const studentEmail of selectedStudents) {
                for (const catalogId of selectedAssignmentIds) {
                    calls.push(api.call('createAssignments', {
                        sessionToken,
                        studentEmails: [studentEmail],
                        catalogId,
                        dueAt: dueDate ? new Date(dueDate).toISOString() : null
                    }, sessionToken));
                }
            }
            await Promise.all(calls);

            alert(`Successfully assigned ${selectedAssignmentIds.length} lesson(s) to ${selectedStudents.length} student(s)`);
            await loadData(sessionToken);
            setSelectedStudents([]);
            setSelectedAssignmentIds([]);
            setDueDate('');
        } catch (error) {
            console.error('Assignment error:', error);
            alert(error.message || 'Failed to create assignments');
        } finally {
            setSubmitting(false);
        }
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
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
                <div className="max-w-screen-xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" onClick={() => navigate('/Dashboard')} className="text-gray-600 hover:text-black">
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Dashboard
                        </Button>
                        <h1 className="text-xl font-bold text-black">Assign Work</h1>
                    </div>
                    <div className="flex items-center gap-3">
                        {(selectedStudents.length > 0 || selectedAssignmentIds.length > 0) && (
                            <span className="text-sm text-gray-500">
                                {selectedStudents.length} student{selectedStudents.length !== 1 ? 's' : ''} · {selectedAssignmentIds.length} lesson{selectedAssignmentIds.length !== 1 ? 's' : ''}
                            </span>
                        )}
                        <div>
                            <label className="text-xs text-gray-500 mr-2">Due Date (optional)</label>
                            <input
                                type="date"
                                value={dueDate}
                                onChange={(e) => setDueDate(e.target.value)}
                                className="text-sm border border-gray-300 rounded-md px-2 py-1"
                            />
                        </div>
                        <Button
                            onClick={handleAssign}
                            disabled={submitting || selectedAssignmentIds.length === 0 || selectedStudents.length === 0}
                            className="bg-purple-900 hover:bg-purple-800 text-white"
                        >
                            {submitting ? 'Assigning...' : 'Assign'}
                        </Button>
                    </div>
                </div>
            </header>

            {/* Split Layout */}
            <div className="max-w-screen-xl mx-auto flex h-[calc(100vh-65px)]">

                {/* LEFT: Student Roster */}
                <aside className="w-72 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
                    <div className="px-4 py-4 border-b border-gray-200">
                        <div className="flex items-center justify-between mb-1">
                            <h2 className="font-semibold text-black flex items-center gap-2">
                                <Users className="w-4 h-4" /> Students
                            </h2>
                            <button onClick={toggleAllStudents} className="text-xs text-purple-700 hover:underline">
                                {selectedStudents.length === students.length ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500">{selectedStudents.length} of {students.length} selected</p>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                        {students.map((student) => {
                            const studentAssignments = existingAssignments.filter(a => a.studentEmail === student.email);
                            const completed = studentAssignments.filter(a => a.status === 'completed').length;
                            const total = studentAssignments.length;
                            return (
                                <div
                                    key={student.email}
                                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${selectedStudents.includes(student.email) ? 'bg-purple-50' : ''}`}
                                    onClick={() => toggleStudent(student.email)}
                                >
                                    <Checkbox
                                        checked={selectedStudents.includes(student.email)}
                                        onCheckedChange={() => toggleStudent(student.email)}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-black truncate">{student.firstName}</p>
                                        <p className="text-xs text-gray-400 truncate">{student.email}</p>
                                        {total > 0 && (
                                            <p className="text-xs text-gray-400">{completed}/{total} done</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </aside>

                {/* RIGHT: Catalog */}
                <main className="flex-1 overflow-y-auto p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                                type="text"
                                placeholder="Search lessons..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                        <p className="text-sm text-gray-500 ml-4">{selectedAssignmentIds.length} lesson{selectedAssignmentIds.length !== 1 ? 's' : ''} selected</p>
                    </div>

                    <div className="space-y-6">
                        {LEVEL_ORDER.map(level => {
                            const items = grouped[level] || [];
                            if (items.length === 0) return null;
                            const allSelected = items.every(i => selectedAssignmentIds.includes(i.id));
                            return (
                                <div key={level}>
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className="inline-block bg-purple-900 text-white text-xs font-bold px-3 py-1 rounded-full">{level}</span>
                                        <span className="text-xs text-gray-400">{items.length} lesson{items.length !== 1 ? 's' : ''}</span>
                                        <button
                                            onClick={() => {
                                                if (allSelected) {
                                                    setSelectedAssignmentIds(prev => prev.filter(id => !items.some(i => i.id === id)));
                                                } else {
                                                    setSelectedAssignmentIds(prev => [...new Set([...prev, ...items.map(i => i.id)])]);
                                                }
                                            }}
                                            className="text-xs text-purple-700 hover:underline ml-auto"
                                        >
                                            {allSelected ? 'Deselect all' : 'Select all'}
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                        {items.map(item => {
                                            const selected = selectedAssignmentIds.includes(item.id);
                                            return (
                                                <div
                                                    key={item.id}
                                                    onClick={() => toggleAssignment(item.id)}
                                                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selected ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                                                >
                                                    <Checkbox
                                                        checked={selected}
                                                        onCheckedChange={() => toggleAssignment(item.id)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="mt-0.5 flex-shrink-0"
                                                    />
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-black leading-snug">{item.title}</p>
                                                        <p className="text-xs text-gray-400 mt-0.5 capitalize">{item.type}</p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                        {grouped['Other']?.length > 0 && (
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <span className="inline-block bg-gray-400 text-white text-xs font-bold px-3 py-1 rounded-full">Other</span>
                                    <span className="text-xs text-gray-400">{grouped['Other'].length} lesson{grouped['Other'].length !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {grouped['Other'].map(item => {
                                        const selected = selectedAssignmentIds.includes(item.id);
                                        return (
                                            <div
                                                key={item.id}
                                                onClick={() => toggleAssignment(item.id)}
                                                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selected ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                                            >
                                                <Checkbox
                                                    checked={selected}
                                                    onCheckedChange={() => toggleAssignment(item.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="mt-0.5 flex-shrink-0"
                                                />
                                                <div>
                                                    <p className="text-sm font-medium text-black">{item.title}</p>
                                                    <p className="text-xs text-gray-400 capitalize">{item.type}</p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}