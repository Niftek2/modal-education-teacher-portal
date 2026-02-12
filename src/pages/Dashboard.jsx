import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Plus, Search, Download, AlertCircle, RefreshCw, Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StudentTable from '../components/StudentTable';
import StudentDetail from '../components/StudentDetail';
import AddStudentModal from '../components/AddStudentModal';
import { api } from '@/components/api';
import { createPageUrl } from '@/utils';

export default function Dashboard() {
    const [teacher, setTeacher] = useState(null);
    const [group, setGroup] = useState(null);
    const [students, setStudents] = useState([]);
    const [filteredStudents, setFilteredStudents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [showStudentDetail, setShowStudentDetail] = useState(false);
    const [syncingQuizzes, setSyncingQuizzes] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        const sessionToken = localStorage.getItem('modal_math_session');
        if (!sessionToken) {
            navigate('/');
            return;
        }

        loadDashboard(sessionToken);
    }, []);

    useEffect(() => {
        if (searchTerm) {
            const filtered = students.filter(s => 
                s.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                s.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                s.email?.toLowerCase().includes(searchTerm.toLowerCase())
            );
            setFilteredStudents(filtered);
        } else {
            setFilteredStudents(students);
        }
    }, [searchTerm, students]);

    const loadDashboard = async (sessionToken) => {
        try {
            setLoading(true);
            console.log('Loading dashboard with token:', sessionToken ? 'Yes' : 'No');

            // Get teacher data
            const teacherResponse = await api.call('getTeacherData', { sessionToken }, sessionToken);

            console.log('Teacher response:', teacherResponse);
            setTeacher(teacherResponse.teacher);
            setGroup(teacherResponse.group);

            // Get students if group exists
            if (teacherResponse.group) {
                const studentsResponse = await api.call('getStudents', {
                    groupId: teacherResponse.group.id,
                    sessionToken
                }, sessionToken);

                setStudents(studentsResponse.students);
                setFilteredStudents(studentsResponse.students);
            }
        } catch (error) {
            console.error('Dashboard error:', error);
            if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
                localStorage.removeItem('modal_math_session');
                navigate('/');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('modal_math_session');
        navigate('/');
    };

    const handleStudentsAdded = () => {
        const sessionToken = localStorage.getItem('modal_math_session');
        loadDashboard(sessionToken);
    };

    const handleStudentSelected = (student) => {
        setSelectedStudent(student);
        setShowStudentDetail(true);
    };

    const exportToCSV = () => {
        const headers = ['Name', 'Email', 'Progress %', 'Completed Lessons', 'Last Activity'];
        const rows = filteredStudents.map(s => [
            `${s.firstName} ${s.lastName}`,
            s.email,
            s.percentage || 0,
            s.completedLessons || 0,
            s.lastActivity ? new Date(s.lastActivity).toLocaleDateString() : 'Never'
        ]);

        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'students.csv';
        a.click();
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
                        <Button
                            onClick={() => navigate(createPageUrl('WebhookDebug'))}
                            variant="ghost"
                            className="text-gray-600 hover:text-black"
                        >
                            <Bug className="w-4 h-4 mr-2" />
                            Webhooks
                        </Button>
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
                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                        <p className="text-sm text-gray-600 mb-1">Total Students</p>
                        <p className="text-3xl font-bold text-black">{students.length}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                        <p className="text-sm text-gray-600 mb-1">Average Progress</p>
                        <p className="text-3xl font-bold text-black">
                            {students.length > 0 
                                ? Math.round(students.reduce((sum, s) => sum + (s.percentage || 0), 0) / students.length)
                                : 0}%
                        </p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                        <p className="text-sm text-gray-600 mb-1">Active This Week</p>
                        <p className="text-3xl font-bold text-black">
                            {students.filter(s => {
                                if (!s.lastActivity) return false;
                                const weekAgo = new Date();
                                weekAgo.setDate(weekAgo.getDate() - 7);
                                return new Date(s.lastActivity) > weekAgo;
                            }).length}
                        </p>
                    </div>
                </div>

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
                    <div className="flex gap-2">
                         <Button
                             onClick={handleSyncQuizzes}
                             disabled={syncingQuizzes}
                             variant="outline"
                             className="border-gray-300"
                         >
                             <RefreshCw className={`w-4 h-4 mr-2 ${syncingQuizzes ? 'animate-spin' : ''}`} />
                             {syncingQuizzes ? 'Syncing...' : 'Sync Activity'}
                         </Button>
                         <Button
                             onClick={exportToCSV}
                             variant="outline"
                             className="border-gray-300"
                         >
                             <Download className="w-4 h-4 mr-2" />
                             Export CSV
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

                {/* Student Table */}
                <StudentTable 
                    students={filteredStudents} 
                    groupId={group.id}
                    onStudentRemoved={handleStudentsAdded}
                    sessionToken={localStorage.getItem('modal_math_session')}
                    onStudentSelected={handleStudentSelected}
                />
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
        </div>
    );
}