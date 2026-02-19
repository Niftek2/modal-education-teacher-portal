import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Search } from 'lucide-react';
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
    return fromCourse || item.level || 'Other';
}

function groupCatalogByLevel(catalog) {
    const grouped = {};
    for (const level of LEVEL_ORDER) grouped[level] = [];
    grouped['Other'] = [];
    for (const item of catalog) {
        const level = resolveLevel(item);
        if (grouped[level] !== undefined) grouped[level].push(item);
        else grouped['Other'].push(item);
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

    const sessionToken = localStorage.getItem('modal_math_session');

    useEffect(() => {
        if (!sessionToken) {
            navigate('/Home');
            return;
        }
        loadData(sessionToken);
    }, []);

    const loadData = async (token) => {
        const activeToken = token || sessionToken;
        try {
            setLoading(true);

            const [catalogRes, rosterRes, assignmentsRes] = await Promise.all([
                api.call('getAssignmentCatalog', {}, null),
                api.call('getAssignPageData', { sessionToken: activeToken }, activeToken),
                api.call('getTeacherAssignments', { sessionToken: activeToken }, activeToken),
            ]);

            const catalogData = (catalogRes.catalog || []).filter(item =>
                !item.title?.startsWith('[TEST]') && item.level !== '[TEST]'
            );
            setCatalog(catalogData);
            setStudents((rosterRes.studentEmails || []).map(email => ({
                email,
                firstName: email.split('@')[0]
            })));
            setExistingAssignments(assignmentsRes.assignments || []);
        } catch (error) {
            console.error('Load error:', error);
            if (error.message?.includes('401') || error.message?.includes('403')) {
                navigate('/Home');
            }
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
        setSelectedStudents(prev => prev.length === students.length ? [] : students.map(s => s.email));
    };

    const toggleAssignment = (id) => {
        setSelectedAssignmentIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const filteredCatalog = searchTerm
        ? catalog.filter(item => {
            const search = searchTerm.toLowerCase();
            return (
                item.title?.toLowerCase().includes(search) ||
                item.topic?.toLowerCase().includes(search) ||
                resolveLevel(item).toLowerCase().includes(search)
            );
          })
        : catalog;

    const grouped = groupCatalogByLevel(filteredCatalog);

    const handleAssign = async () => {
        if (!selectedAssignmentIds.length || !selectedStudents.length) {
            alert('Please select at least one student and one assignment.');
            return;
        }
        try {
            setSubmitting(true);
            const studentEmails = selectedStudents.map(s => s.toLowerCase().trim());
            const activeToken = localStorage.getItem('modal_math_session');
            const calls = selectedAssignmentIds.map(catalogId =>
                api.call('createAssignments', {
                    sessionToken: activeToken,
                    studentEmails,
                    catalogId,
                    dueAt: dueDate ? new Date(dueDate).toISOString() : null
                }, activeToken)
            );
            await Promise.all(calls);
            alert(`✅ Assignments successfully sent to ${selectedStudents.length} student(s)!`);
            setSelectedStudents([]);
            setSelectedAssignmentIds([]);
            setDueDate('');
            await loadData(activeToken);
        } catch (error) {
            alert(error.message || 'Failed to create assignments');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-center">
                    <div className="w-10 h-10 border-4 border-purple-200 border-t-purple-900 rounded-full animate-spin mx-auto mb-3"></div>
                    <p className="text-gray-500 text-sm">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Top bar */}
            <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
                <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="sm" onClick={() => navigate('/Dashboard')} className="text-gray-600">
                            <ArrowLeft className="w-4 h-4 mr-1" /> Dashboard
                        </Button>
                        <span className="text-gray-300">|</span>
                        <h1 className="text-base font-semibold text-black">Assign Work</h1>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-500">
                            {selectedStudents.length} student{selectedStudents.length !== 1 ? 's' : ''} · {selectedAssignmentIds.length} lesson{selectedAssignmentIds.length !== 1 ? 's' : ''}
                        </span>
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-500">Due:</label>
                            <input
                                type="date"
                                value={dueDate}
                                onChange={(e) => setDueDate(e.target.value)}
                                className="text-sm border border-gray-300 rounded-md px-2 py-1"
                            />
                        </div>
                        <Button
                            onClick={handleAssign}
                            disabled={submitting || !selectedAssignmentIds.length || !selectedStudents.length}
                            className="bg-purple-900 hover:bg-purple-800 text-white"
                        >
                            {submitting ? 'Assigning...' : 'Assign'}
                        </Button>
                    </div>
                </div>
            </header>

            {/* Body: split layout */}
            <div className="flex flex-1 overflow-hidden max-w-screen-xl mx-auto w-full">

                {/* LEFT: Students */}
                <aside className="w-64 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                        <span className="font-semibold text-sm text-black flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5" /> Students
                        </span>
                        <button onClick={toggleAllStudents} className="text-xs text-purple-700 hover:underline">
                            {selectedStudents.length === students.length ? 'Deselect all' : 'Select all'}
                        </button>
                    </div>
                    <p className="text-xs text-gray-400 px-4 py-1.5 border-b border-gray-100">
                        {selectedStudents.length} of {students.length} selected
                    </p>
                    <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                        {students.map((student) => {
                            const sa = existingAssignments.filter(a => a.studentEmail === student.email);
                            const completed = sa.filter(a => a.status === 'completed').length;
                            const isSelected = selectedStudents.includes(student.email);
                            return (
                                <div
                                    key={student.email}
                                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-purple-50' : ''}`}
                                    onClick={() => toggleStudent(student.email)}
                                >
                                    <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={() => toggleStudent(student.email)}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-black truncate">{student.firstName}</p>
                                        <p className="text-xs text-gray-400 truncate">{student.email}</p>
                                        {sa.length > 0 && (
                                            <p className="text-xs text-gray-400">{completed}/{sa.length} done</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </aside>

                {/* RIGHT: Catalog */}
                <main className="flex-1 overflow-y-auto p-5">
                    <div className="flex items-center gap-4 mb-5">
                        <div className="relative max-w-xs w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                                placeholder="Search lessons..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </div>

                    <div className="space-y-6">
                        {[...LEVEL_ORDER, 'Other'].map(level => {
                            const items = grouped[level] || [];
                            if (!items.length) return null;
                            const allSelected = items.every(i => selectedAssignmentIds.includes(i.id));
                            return (
                                <div key={level}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full text-white ${level === 'Other' ? 'bg-gray-400' : 'bg-purple-900'}`}>
                                            {level}
                                        </span>
                                        <span className="text-xs text-gray-400">{items.length} lesson{items.length !== 1 ? 's' : ''}</span>
                                        <button
                                            onClick={() => allSelected
                                                ? setSelectedAssignmentIds(prev => prev.filter(id => !items.some(i => i.id === id)))
                                                : setSelectedAssignmentIds(prev => [...new Set([...prev, ...items.map(i => i.id)])])
                                            }
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
                                                    className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${selected ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                                                >
                                                    <Checkbox
                                                        checked={selected}
                                                        onCheckedChange={() => toggleAssignment(item.id)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="mt-0.5 flex-shrink-0"
                                                    />
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-black leading-snug">{item.displayTitle || item.title}</p>
                                                        {item.topic && (
                                                            <p className="text-xs text-gray-500 uppercase tracking-wide mt-0.5">Chapter: {item.topic}</p>
                                                        )}
                                                        <p className="text-xs text-gray-400 mt-0.5 capitalize">{item.type}</p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </main>
            </div>
        </div>
    );
}