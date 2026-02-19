import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Search, RefreshCw, ChevronDown, Check } from 'lucide-react';
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
    const [syncingCatalog, setSyncingCatalog] = useState(false);
    const [teacherEmail, setTeacherEmail] = useState('');
    const [pageLoaded, setPageLoaded] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [catalogSearch, setCatalogSearch] = useState('');
    const dropdownRef = useRef(null);
    const navigate = useNavigate();

    useEffect(() => {
        const sessionToken = localStorage.getItem('modal_math_session');
        if (!sessionToken) {
            navigate('/Home');
            return;
        }
        loadData(sessionToken);
    }, []);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const getLocalRosterEmails = () => {
        try {
            const raw = localStorage.getItem('mm_teacher_roster_emails');
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    };

    const loadData = async (token) => {
        const activeToken = token || localStorage.getItem('modal_math_session');
        try {
            setLoading(true);

            const result = await api.call('getTeacherAssignments', { sessionToken: activeToken }, activeToken);

            // Capture teacher email from session result for use during assignment
            if (result.teacherEmail) setTeacherEmail(result.teacherEmail);

            const catalogData = (result.catalog || []).filter(item =>
                !item.title?.startsWith('[TEST]') && item.level !== '[TEST]'
            );
            setCatalog(catalogData);
            setExistingAssignments(result.assignments || []);

            // Use local roster first, fall back to backend result
            const localEmails = getLocalRosterEmails();
            const rosterEmails = localEmails.length
                ? localEmails
                : (result.students || []).map(s => s.email).filter(Boolean);

            const rosterStudents = rosterEmails
                .map(email => ({
                    email: String(email).toLowerCase().trim(),
                    firstName: String(email).split('@')[0],
                    lastName: '',
                }))
                .sort((a, b) => a.email.localeCompare(b.email));

            setStudents(rosterStudents);
            setPageLoaded(true);
        } catch (error) {
            console.error('Load error:', error.message);
            localStorage.removeItem('modal_math_session');
            navigate('/Home');
        } finally {
            setLoading(false);
        }
    };

    const handleSyncCatalog = async () => {
        try {
            setSyncingCatalog(true);
            const activeToken = localStorage.getItem('modal_math_session');
            await api.call('syncAssignmentCatalog', { sessionToken: activeToken }, activeToken);
            await loadData(activeToken);
        } catch (e) {
            alert(e.message || 'Catalog sync failed');
        } finally {
            setSyncingCatalog(false);
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
                    dueAt: dueDate ? new Date(dueDate).toISOString() : null,
                    assignPageOk: pageLoaded,
                    teacherEmail
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
                                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-purple-50' : ''} ${student.isArchived ? 'opacity-50' : ''}`}
                                    onClick={() => toggleStudent(student.email)}
                                >
                                    <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={() => toggleStudent(student.email)}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-black truncate">{student.email.split('@')[0]}</p>
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
                    <div className="flex items-center gap-3 mb-5">
                        {/* Searchable multiselect dropdown */}
                        <div className="relative flex-1 max-w-lg" ref={dropdownRef}>
                            <button
                                type="button"
                                onClick={() => { setDropdownOpen(o => !o); setCatalogSearch(''); }}
                                className="w-full flex items-center justify-between border border-gray-300 rounded-md px-3 py-2 bg-white text-sm text-left hover:border-purple-400 focus:outline-none"
                            >
                                <span className={selectedAssignmentIds.length ? 'text-black' : 'text-gray-400'}>
                                    {selectedAssignmentIds.length
                                        ? `${selectedAssignmentIds.length} lesson${selectedAssignmentIds.length !== 1 ? 's' : ''} selected`
                                        : 'Select lessons…'}
                                </span>
                                <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            </button>

                            {dropdownOpen && (
                                <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
                                    {/* Search inside dropdown */}
                                    <div className="p-2 border-b border-gray-100">
                                        <div className="relative">
                                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                            <input
                                                autoFocus
                                                placeholder="Search lessons..."
                                                value={catalogSearch}
                                                onChange={e => setCatalogSearch(e.target.value)}
                                                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-400"
                                            />
                                        </div>
                                    </div>

                                    {/* List */}
                                    <div className="overflow-y-auto max-h-80">
                                        {[...LEVEL_ORDER, 'Other'].map(level => {
                                            const levelItems = (grouped[level] || []).filter(item => {
                                                if (!catalogSearch) return true;
                                                const s = catalogSearch.toLowerCase();
                                                return (
                                                    item.title?.toLowerCase().includes(s) ||
                                                    item.topic?.toLowerCase().includes(s) ||
                                                    resolveLevel(item).toLowerCase().includes(s)
                                                );
                                            });
                                            if (!levelItems.length) return null;
                                            return (
                                                <div key={level}>
                                                    <div className="px-3 py-1.5 text-xs font-bold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                                                        {level}
                                                    </div>
                                                    {levelItems.map(item => {
                                                        const selected = selectedAssignmentIds.includes(item.id);
                                                        return (
                                                            <div
                                                                key={item.id}
                                                                onClick={() => toggleAssignment(item.id)}
                                                                className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-purple-50 ${selected ? 'bg-purple-50' : ''}`}
                                                            >
                                                                <div className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${selected ? 'bg-purple-900 border-purple-900' : 'border-gray-300'}`}>
                                                                    {selected && <Check className="w-3 h-3 text-white" />}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="text-sm text-black leading-snug truncate">
                                                                        <span className="font-medium text-purple-800">
                                                                            {(item.chapterName || item.topic || 'Item') + ':'}
                                                                        </span>{' '}
                                                                        {item.title}
                                                                    </p>
                                                                    {(item.topic || item.lessonType) && (
                                                                        <p className="text-xs text-gray-400 truncate">
                                                                            {item.topic}{item.lessonType ? ` · ${item.lessonType}` : ''}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Footer: clear + close */}
                                    <div className="p-2 border-t border-gray-100 flex justify-between items-center">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedAssignmentIds([])}
                                            className="text-xs text-gray-500 hover:text-gray-700"
                                        >
                                            Clear all
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDropdownOpen(false)}
                                            className="text-xs text-purple-700 font-medium hover:underline"
                                        >
                                            Done
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Sync button */}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSyncCatalog}
                            disabled={syncingCatalog}
                            className="flex-shrink-0 border-gray-300 text-gray-600"
                        >
                            <RefreshCw className={`w-4 h-4 mr-1.5 ${syncingCatalog ? 'animate-spin' : ''}`} />
                            {syncingCatalog ? 'Syncing…' : 'Sync'}
                        </Button>
                    </div>

                    {/* Selected lesson chips */}
                    {selectedAssignmentIds.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {selectedAssignmentIds.map(id => {
                                const item = catalog.find(c => c.id === id);
                                if (!item) return null;
                                return (
                                    <span
                                        key={id}
                                        onClick={() => toggleAssignment(id)}
                                        className="flex items-center gap-1.5 text-xs bg-purple-100 text-purple-900 rounded-full px-3 py-1 cursor-pointer hover:bg-purple-200"
                                    >
                                        <span className="font-medium">{item.contentType === 'quiz' ? 'Quiz' : 'Lesson'}:</span>{' '}{item.title}
                                        <span className="text-purple-500">×</span>
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}