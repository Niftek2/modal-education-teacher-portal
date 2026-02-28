import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Plus, Search, AlertCircle, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import StudentTable from '../components/StudentTable';
import StudentDetail from '../components/StudentDetail';
import AddStudentModal from '../components/AddStudentModal';
import SnapshotModal from '../components/SnapshotModal';
import { api } from '@/components/api';
import { base44 } from '@/api/base44Client';

export default function Dashboard() {
    const [teacher, setTeacher] = useState(null);
    const [group, setGroup] = useState(null);
    const [activeStudents, setActiveStudents] = useState([]);
    const [archivedStudents, setArchivedStudents] = useState([]);
    const [studentActivities, setStudentActivities] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [showStudentDetail, setShowStudentDetail] = useState(false);
    const [showSnapshot, setShowSnapshot] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        const sessionToken = localStorage.getItem('modal_math_session');
        if (!sessionToken) {
            navigate('/Home');
            return;
        }

        loadDashboard(sessionToken);
    }, []);

    const loadDashboard = async (sessionToken) => {
        try {
            setLoading(true);
            console.log('[Dashboard] load start');

            const teacherResponse = await api.call('getTeacherData', { sessionToken }, sessionToken);
            setTeacher(teacherResponse.teacher);

            const primaryGroup = teacherResponse.groups?.[0] || null;
            setGroup(primaryGroup);

            if (primaryGroup && teacherResponse.teacher?.email) {
                const teacherEmail = teacherResponse.teacher.email.toLowerCase().trim();

                // Fetch students (active + archived) and activity in parallel
                const [studentsResponse, activityResponse] = await Promise.all([
                    base44.functions.invoke('getStudents', { teacherEmail, groupId: primaryGroup.id }),
                    api.call('getStudentActivityForTeacher', { sessionToken }, sessionToken).catch(() => ({ studentEmails: [], events: [] })),
                ]);

                const { activeStudents: active = [], archivedStudents: archived = [] } = studentsResponse.data || {};
                setActiveStudents(active);
                setArchivedStudents(archived);
                setStudentActivities(activityResponse.events || []);

                // Persist roster for Assign page
                const rosterEmails = activityResponse.studentEmails || [];
                if (rosterEmails.length > 0) {
                    localStorage.setItem('mm_teacher_roster_emails', JSON.stringify(rosterEmails));
                    localStorage.setItem('mm_teacher_roster_saved_at', new Date().toISOString());
                }
            }
        } catch (error) {
            console.error('[Dashboard] load error:', error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('modal_math_session');
        navigate('/Home');
    };

    const handleStudentsAdded = () => {
        const sessionToken = localStorage.getItem('modal_math_session');
        loadDashboard(sessionToken);
    };

    const handleStudentSelected = (student) => {
        setSelectedStudent(student);
        setShowStudentDetail(true);
    };



    const handleSyncQuizzes = async () => {
        try {
            setSyncingQuizzes(true);
            const sessionToken = localStorage.getItem('modal_math_session');
            
            const result = await api.call('syncActivityBackfill', {
                groupId: group.id,
                sessionToken
            }, sessionToken);
            
            console.log('Sync result:', result);
            
            // Reload dashboard to show new data
            await loadDashboard(sessionToken);
            
            alert(result.message || `Success! Imported ${result.eventsImported} activity events for ${result.studentsProcessed} students.`);
        } catch (error) {
            console.error('Failed to sync data:', error);
            alert(error.message || 'Sync failed. Please try again.');
        } finally {
            setSyncingQuizzes(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-900 rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    if (!group) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-6">
                <div className="max-w-md text-center">
                    <AlertCircle className="w-16 h-16 text-purple-900 mx-auto mb-4" />
                    <h1 className="text-2xl font-semibold text-black mb-2">No Group Assigned</h1>
                    <p className="text-gray-600 mb-6">
                        You don't have a group set up yet. Please contact Modal Math support to create your classroom group.
                    </p>
                    <Button onClick={handleLogout} variant="outline">
                        Logout
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white">
            {/* Header */}
            <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-black">Modal Math</h1>
                        <p className="text-sm text-gray-600">
                            {teacher?.firstName} {teacher?.lastName} · {group?.name}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        {teacher?.role === 'admin' && (
                            <Button
                                onClick={() => setShowSnapshot(true)}
                                variant="ghost"
                                className="text-gray-600 hover:text-black"
                            >
                                <Settings className="w-4 h-4 mr-2" />
                                Diagnostics
                            </Button>
                        )}
                        <Button
                            onClick={handleLogout}
                            variant="ghost"
                            className="text-gray-600 hover:text-black"
                        >
                            <LogOut className="w-4 h-4 mr-2" />
                            Logout
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-6 py-8">
                {/* Actions Bar */}
                <div className="flex flex-col sm:flex-row gap-4 mb-6">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <Input
                            type="text"
                            placeholder="Search students..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 border-gray-300"
                        />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <Button
                            onClick={() => setShowArchived(true)}
                            variant="outline"
                            className="border-gray-300"
                        >
                            <Archive className="w-4 h-4 mr-2" />
                            Archived
                        </Button>
                        <Button
                            onClick={() => navigate('/Assign')}
                            variant="outline"
                            className="border-purple-900 text-purple-900 hover:bg-purple-50"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Assign
                        </Button>
                        <Button
                            onClick={() => setShowAddModal(true)}
                            className="bg-purple-900 hover:bg-purple-800 text-white"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Add Students
                        </Button>
                    </div>
                </div>

                {/* Roster Sync Banner */}
                {rosterSyncError && (
                    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                        <p className="text-sm text-yellow-800 font-medium">
                            Using saved roster. Sync may be delayed.
                            {rosterLastUpdated && (
                                <span className="text-xs text-yellow-600 ml-2">
                                    (Last updated: {new Date(rosterLastUpdated).toLocaleString()})
                                </span>
                            )}
                        </p>
                    </div>
                )}

                {/* Student Table */}
                <StudentTable 
                    students={filteredStudents} 
                    groupId={group.id}
                    onStudentRemoved={handleStudentsAdded}
                    sessionToken={localStorage.getItem('modal_math_session')}
                    onStudentSelected={handleStudentSelected}
                    activities={studentActivities}
                />
                {filteredStudents.length === 0 && rosterLastUpdated && !rosterSyncError && (
                    <p className="text-xs text-gray-400 mt-3 text-center">
                        Roster last updated: {new Date(rosterLastUpdated).toLocaleString()}
                    </p>
                )}
            </main>

            {/* Add Student Modal */}
            {showAddModal && (
                <AddStudentModal
                    groupId={group.id}
                    onClose={() => setShowAddModal(false)}
                    onSuccess={handleStudentsAdded}
                />
            )}

            {/* Student Detail Modal */}
            <StudentDetail
                student={selectedStudent}
                isOpen={showStudentDetail}
                onClose={() => {
                    setShowStudentDetail(false);
                    setSelectedStudent(null);
                }}
                sessionToken={localStorage.getItem('modal_math_session')}
            />



            {/* Snapshot Modal */}
            {showSnapshot && (
                <SnapshotModal
                    sessionToken={localStorage.getItem('modal_math_session')}
                    onClose={() => setShowSnapshot(false)}
                />
            )}

            {/* Archived Students Modal */}
            {showArchived && (
                <ArchivedStudentsModal
                    isOpen={showArchived}
                    onClose={() => setShowArchived(false)}
                    sessionToken={localStorage.getItem('modal_math_session')}
                />
            )}
        </div>
    );
}