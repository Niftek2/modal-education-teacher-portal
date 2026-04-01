import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Shield, Loader2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/components/api';
import TeacherRow from '@/components/admin/TeacherRow';

const ALLOWED_ADMINS = ['nadiajiftekhar@gmail.com', 'modalmath@gmail.com'];

export default function AdminDashboard() {
    const [sessionToken, setSessionToken] = useState(null);
    const [adminEmail, setAdminEmail] = useState('');
    const [teachers, setTeachers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const token = localStorage.getItem('modal_math_session');
        if (token) {
            // Decode JWT to check email
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                if (ALLOWED_ADMINS.includes(payload.email?.toLowerCase())) {
                    setSessionToken(token);
                    setAdminEmail(payload.email);
                    loadData(token);
                }
            } catch {}
        }
    }, []);

    const loadData = async (token) => {
        setLoading(true);
        setError(null);
        try {
            const result = await api.call('adminGetOverview', {}, token);
            setTeachers(result.teachers || []);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const filteredTeachers = teachers.filter(t =>
        !search || t.email?.toLowerCase().includes(search.toLowerCase())
    );

    const totalActive = teachers.reduce((sum, t) => sum + t.dbStudents.filter(s => s.status === 'active').length, 0);
    const totalArchived = teachers.reduce((sum, t) => sum + t.dbStudents.filter(s => s.status === 'archived').length, 0);
    const outOfSync = teachers.filter(t => {
        const active = t.dbStudents.filter(s => s.status === 'active').length;
        return active !== (t.thinkificStudents?.length || 0);
    }).length;

    if (!sessionToken) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-6">
                <div className="text-center max-w-sm">
                    <Shield className="w-12 h-12 text-purple-900 mx-auto mb-4" />
                    <h1 className="text-xl font-bold text-gray-900 mb-2">Admin Access Only</h1>
                    <p className="text-gray-500 text-sm mb-4">You must be logged in as an admin to view this page.</p>
                    <Button onClick={() => navigate('/Home')} className="bg-[#632a8c] hover:bg-[#7b35ae] text-white">
                        Go to Login
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Shield className="w-5 h-5 text-purple-800" />
                        <div>
                            <h1 className="text-lg font-bold text-gray-900">Admin Dashboard</h1>
                            <p className="text-xs text-gray-500">{adminEmail}</p>
                        </div>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => loadData(sessionToken)}
                        disabled={loading}
                        className="border-gray-300"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                        Refresh
                    </Button>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-8">
                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-gray-900">{teachers.length}</p>
                        <p className="text-xs text-gray-500 mt-0.5">Teachers</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-gray-900">{totalActive}</p>
                        <p className="text-xs text-gray-500 mt-0.5">Active Students (DB)</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-gray-900">{totalArchived}</p>
                        <p className="text-xs text-gray-500 mt-0.5">Archived Students</p>
                    </div>
                    <div className={`border rounded-xl p-4 text-center ${outOfSync > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
                        <p className={`text-2xl font-bold ${outOfSync > 0 ? 'text-amber-700' : 'text-green-700'}`}>{outOfSync}</p>
                        <p className={`text-xs mt-0.5 ${outOfSync > 0 ? 'text-amber-600' : 'text-green-600'}`}>Out of Sync</p>
                    </div>
                </div>

                {/* Search */}
                <div className="mb-4">
                    <Input
                        placeholder="Search by teacher email..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="max-w-sm"
                    />
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-purple-700" />
                    </div>
                ) : filteredTeachers.length === 0 ? (
                    <div className="text-center py-20 text-gray-400">
                        <Users className="w-10 h-10 mx-auto mb-3" />
                        <p>No teachers found.</p>
                    </div>
                ) : (
                    <div>
                        <p className="text-xs text-gray-400 mb-3">{filteredTeachers.length} teacher(s) shown</p>
                        {filteredTeachers.map(teacher => (
                            <TeacherRow
                                key={teacher.email}
                                teacher={teacher}
                                sessionToken={sessionToken}
                                onRefresh={() => loadData(sessionToken)}
                            />
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}