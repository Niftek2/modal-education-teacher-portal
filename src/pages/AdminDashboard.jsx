import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Shield, Loader2, Users, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/components/api';
import TeacherRow from '@/components/admin/TeacherRow';

const ALLOWED_ADMINS_SET = new Set(['nadiajiftekhar@gmail.com', 'modalmath@gmail.com']);

function AdminLogin({ onLogin }) {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Check if there's already a valid token in localStorage on mount
    useEffect(() => {
        const token = localStorage.getItem('modal_math_session');
        if (token) {
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                if (ALLOWED_ADMINS_SET.has(payload.email?.toLowerCase())) {
                    onLogin(token, payload.email);
                }
            } catch {}
        }
    }, []);

    const handleSend = async (e) => {
        e.preventDefault();
        if (!ALLOWED_ADMINS_SET.has(email.toLowerCase())) {
            setError('This email is not authorized as an admin.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            await api.call('authRequestLink', { email });
            setSent(true);
        } catch (err) {
            setError(err.message || 'Failed to send login link');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-white flex items-center justify-center p-6">
            <div className="max-w-sm w-full">
                <div className="text-center mb-8">
                    <Shield className="w-12 h-12 text-purple-900 mx-auto mb-3" />
                    <h1 className="text-2xl font-bold text-gray-900">Admin Login</h1>
                    <p className="text-gray-500 text-sm mt-1">Enter your admin email to receive a magic link</p>
                </div>
                {sent ? (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                        <p className="text-green-800 font-medium">Magic link sent to <strong>{email}</strong></p>
                        <p className="text-green-700 text-sm mt-1">Click the link in your email to log in.</p>
                    </div>
                ) : (
                    <form onSubmit={handleSend} className="space-y-4">
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="admin@example.com"
                                className="pl-10"
                                required
                            />
                        </div>
                        {error && <p className="text-red-600 text-sm">{error}</p>}
                        <Button type="submit" disabled={loading} className="w-full bg-[#632a8c] hover:bg-[#7b35ae] text-white">
                            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Send Magic Link
                        </Button>
                    </form>
                )}
            </div>
        </div>
    );
}

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
        return <AdminLogin onLogin={(token, email) => { setSessionToken(token); setAdminEmail(email); loadData(token); }} />;
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