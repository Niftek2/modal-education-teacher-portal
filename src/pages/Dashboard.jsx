import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Plus, Search, AlertCircle, Settings, Upload, School, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import StudentTable from '../components/StudentTable';
import StudentDetail from '../components/StudentDetail';
import AddStudentModal from '../components/AddStudentModal';
import SnapshotModal from '../components/SnapshotModal';
import AddHistoricalDataModal from '../components/AddHistoricalDataModal';
import { api } from '@/components/api';
import GrowthMetrics from '@/components/GrowthMetrics.jsx';

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
    const [showHistoricalModal, setShowHistoricalModal] = useState(false);
    const [settingUpClassroom, setSettingUpClassroom] = useState(false);
    const [setupError, setSetupError] = useState('');
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
                localStorage.setItem('modal_math_teacher_email', teacherEmail);

                // Fetch students (active + archived) and activity in parallel
                const [studentsResponse, activityResponse] = await Promise.all([
                    api.call('getStudents', { teacherEmail, groupId: primaryGroup.id }),
                    api.call('getStudentActivityForTeacher', { sessionToken }, sessionToken).catch(() => ({ studentEmails: [], events: [] })),
                ]);

                const { activeStudents: active = [], archivedStudents: archived = [] } = studentsResponse || {};
                setActiveStudents(active);
                setArchivedStudents(archived);
                setStudentActivities(activityResponse.events || []);

                // Persist roster for Assign page (include names + level so Assign shows real data)
                const rosterEmails = active.map(s => s.email);
                const rosterStudents = active.map(s => ({
                    email: s.email,
                    firstName: s.firstName || '',
                    lastName: s.lastName || '',
                    level: s.level || null,
                }));
                if (rosterEmails.length > 0) {
                    localStorage.setItem('mm_teacher_roster_emails', JSON.stringify(rosterEmails));
                    localStorage.setItem('mm_teacher_roster_students', JSON.stringify(rosterStudents));
                    localStorage.setItem('mm_teacher_roster_saved_at', new Date().toISOString());
                }
            }
        } catch (error) {
            console.error('[Dashboard] load error:', error.message);
            if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
                localStorage.removeItem('modal_math_session');
                navigate('/Home');
            }
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

    const handleSetupClassroom = async () => {
        const sessionToken = localStorage.getItem('modal_math_session');
        if (!sessionToken) {
            navigate('/Home');
            return;
        }

        try {
            setSettingUpClassroom(true);
            setSetupError('');
            await api.call('setupTeacherClassroom', { sessionToken }, sessionToken);
            await loadDashboard(sessionToken);
        } catch (error) {
            setSetupError(error.message || 'We could not set up your classroom. Please try again.');
        } finally {
            setSettingUpClassroom(false);
        }
    };

    const handleStudentSelected = (student) => {
        setSelectedStudent(student);
        setShowStudentDetail(true);
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
            <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white flex items-center justify-center p-6">
                <div className="w-full max-w-lg rounded-2xl border border-purple-100 bg-white p-8 shadow-sm text-center">
                    <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-5">
                        <School className="w-8 h-8 text-[#632a8c]" aria-hidden="true" />
                    </div>
                    <h1 className="text-2xl font-semibold text-black mb-2">Set Up Your Classroom</h1>
                    <p className="text-gray-700 mb-2">
                        Your teacher access is active{teacher?.firstName ? `, ${teacher.firstName}` : ''}.
                    </p>
                    <p className="text-gray-600 mb-6">
                        Create your classroom to add students, assign activities, and view progress from this dashboard.
                    </p>

                    {setupError && (
                        <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-left text-sm text-red-700 flex gap-2">
                            <AlertCircle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                            <span>{setupError}</span>
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-3 justify-center" aria-live="polite">
                        <Button
                            onClick={handleSetupClassroom}
                            disabled={settingUpClassroom}
                            className="bg-[#632a8c] hover:bg-[#7b35ae] text-white"
                        >
                            {settingUpClassroom ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                                    Creating Classroom...
                                </>
                            ) : (
                                <>
                                    <School className="w-4 h-4 mr-2" aria-hidden="true" />
                                    Create My Classroom
                                </>
                            )}
                        </Button>
                        <Button onClick={handleLogout} variant="outline" disabled={settingUpClassroom}>
                            <LogOut className="w-4 h-4 mr-2" aria-hidden="true" />
                            Logout
                        </Button>
                    </div>
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
                            onClick={() => navigate('/Assign')}
                            variant="outline"
                            className="border-[#632a8c] text-[#632a8c] hover:bg-purple-50"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Assign
                        </Button>
                        <Button
                            onClick={() => setShowAddModal(true)}
                            className="bg-[#632a8c] hover:bg-[#7b35ae] text-white"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Add Students ({activeStudents.length}/10)
                        </Button>
                        <Button
                            onClick={() => setShowHistoricalModal(true)}
                            variant="outline"
                            className="border-gray-400 text-gray-600 hover:bg-gray-50"
                        >
                            <Upload className="w-4 h-4 mr-2" />
                            Historical Data
                        </Button>
                    </div>
                </div>

                {/* Tabbed Roster */}
                <Tabs defaultValue="active">
                    <TabsList className="mb-4 bg-gray-100">
                        <TabsTrigger
                            value="active"
                            className="data-[state=active]:bg-[#632a8c] data-[state=active]:text-white"
                        >
                            Active Roster ({activeStudents.length})
                        </TabsTrigger>
                        <TabsTrigger
                            value="archived"
                            className="data-[state=active]:bg-[#632a8c] data-[state=active]:text-white"
                        >
                            Archive ({archivedStudents.length})
                        </TabsTrigger>
                        <TabsTrigger
                            value="growth"
                            className="data-[state=active]:bg-[#632a8c] data-[state=active]:text-white"
                        >
                            Growth Metrics
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="active">
                        <StudentTable
                            students={activeStudents.filter(s =>
                                !searchTerm ||
                                s.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                s.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                s.email?.toLowerCase().includes(searchTerm.toLowerCase())
                            )}
                            type="active"
                            teacherEmail={teacher?.email}
                            groupId={group.id}
                            onStudentRemoved={handleStudentsAdded}
                            sessionToken={localStorage.getItem('modal_math_session')}
                            onStudentSelected={handleStudentSelected}
                            activities={studentActivities}
                        />
                    </TabsContent>

                    <TabsContent value="archived">
                        <StudentTable
                            students={archivedStudents.filter(s =>
                                !searchTerm ||
                                s.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                s.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                s.email?.toLowerCase().includes(searchTerm.toLowerCase())
                            )}
                            type="archived"
                            teacherEmail={teacher?.email}
                            groupId={group.id}
                            onStudentRemoved={handleStudentsAdded}
                            sessionToken={localStorage.getItem('modal_math_session')}
                            onStudentSelected={handleStudentSelected}
                            activities={studentActivities}
                        />
                    </TabsContent>

                    <TabsContent value="growth">
                        <GrowthMetrics
                            students={activeStudents}
                            events={studentActivities}
                        />
                    </TabsContent>
                </Tabs>
            </main>

            {/* Add Student Modal */}
            {showAddModal && (
                <AddStudentModal
                    groupId={group.id}
                    teacherEmail={teacher?.email}
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



            {/* Historical Data Modal */}
            {showHistoricalModal && (
                <AddHistoricalDataModal
                    teacherEmail={teacher?.email}
                    onClose={() => setShowHistoricalModal(false)}
                />
            )}

            {/* Snapshot Modal */}
            {showSnapshot && (
                <SnapshotModal
                    sessionToken={localStorage.getItem('modal_math_session')}
                    onClose={() => setShowSnapshot(false)}
                />
            )}


        </div>
    );
}