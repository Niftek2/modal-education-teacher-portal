import React, { useState } from 'react';
import { RefreshCw, UserPlus, UserMinus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/components/api';
import StudentEnrollmentPanel from './StudentEnrollmentPanel';

export default function GroupManagePanel({ group, teacher, sessionToken, onRefresh }) {
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState(null);
    const [addEmail, setAddEmail] = useState('');
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState(null);
    const [message, setMessage] = useState(null);

    const showMsg = (text, isError = false) => {
        setMessage({ text, isError });
        setTimeout(() => setMessage(null), 4000);
    };

    const handleSync = async () => {
        setSyncing(true);
        setSyncResult(null);
        try {
            const result = await api.call('adminManageGroup', {
                action: 'sync',
                teacherEmail: teacher.email,
                groupId: group.groupId,
            }, sessionToken);
            setSyncResult(result);
            showMsg(`Sync done: ${result.added?.length || 0} added, ${result.skipped?.length || 0} already in group, ${result.errors?.length || 0} errors.`);
            onRefresh();
        } catch (e) {
            showMsg(e.message, true);
        } finally {
            setSyncing(false);
        }
    };

    const handleAdd = async () => {
        if (!addEmail.trim()) return;
        setAdding(true);
        try {
            await api.call('adminManageGroup', {
                action: 'add',
                studentEmail: addEmail.trim().toLowerCase(),
                groupId: group.groupId,
                teacherEmail: teacher.email,
            }, sessionToken);
            showMsg(`Added ${addEmail} to group successfully.`);
            setAddEmail('');
            onRefresh();
        } catch (e) {
            showMsg(e.message, true);
        } finally {
            setAdding(false);
        }
    };

    const handleRemove = async (student) => {
        setRemoving(student.email);
        try {
            await api.call('adminManageGroup', {
                action: 'remove',
                studentEmail: student.email,
                groupId: group.groupId,
                userId: student.id,
                teacherEmail: teacher.email,
            }, sessionToken);
            showMsg(`Removed ${student.email} from group.`);
            onRefresh();
        } catch (e) {
            showMsg(e.message, true);
        } finally {
            setRemoving(null);
        }
    };

    const thinkificStudents = (teacher.thinkificStudents || []).filter(s => s.groupId === group.groupId);
    const activeDbStudents = teacher.dbStudents.filter(s => s.status === 'active');
    const thinkificEmails = new Set(thinkificStudents.map(s => s.email));
    const missingFromThinkific = activeDbStudents.filter(s => !thinkificEmails.has(s.email?.toLowerCase()));

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm text-gray-700">
                    Group: <span className="text-purple-800">{group.groupName}</span>
                    <span className="ml-2 text-gray-400 font-normal">ID: {group.groupId}</span>
                </h4>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSync}
                    disabled={syncing}
                    className="border-purple-300 text-purple-700 hover:bg-purple-50"
                >
                    {syncing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                    Sync DB → Thinkific
                </Button>
            </div>

            {message && (
                <div className={`text-sm px-3 py-2 rounded-lg ${message.isError ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                    {message.text}
                </div>
            )}

            {missingFromThinkific.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                    <strong>{missingFromThinkific.length} student(s)</strong> are in DB but missing from Thinkific group:&nbsp;
                    {missingFromThinkific.map(s => s.email).join(', ')}
                </div>
            )}

            {/* Add student manually */}
            <div className="flex gap-2">
                <Input
                    placeholder="student@modalmath.com"
                    value={addEmail}
                    onChange={e => setAddEmail(e.target.value)}
                    className="text-sm h-8"
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
                <Button size="sm" onClick={handleAdd} disabled={adding || !addEmail.trim()} className="bg-[#632a8c] hover:bg-[#7b35ae] text-white flex-shrink-0">
                    {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3 mr-1" />}
                    Add
                </Button>
            </div>

            {/* Thinkific group members */}
            {thinkificStudents.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No students currently in Thinkific group.</p>
            ) : (
                <div className="space-y-1">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">In Thinkific Group ({thinkificStudents.length})</p>
                    {thinkificStudents.map(s => (
                        <div key={s.email} className="bg-white border border-gray-100 rounded-lg px-3 py-2">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-gray-800">{s.firstName} {s.lastName}</p>
                                    <p className="text-xs text-gray-500">{s.email}</p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemove(s)}
                                    disabled={removing === s.email}
                                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                >
                                    {removing === s.email ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserMinus className="w-3 h-3" />}
                                </Button>
                            </div>
                            <StudentEnrollmentPanel student={s} sessionToken={sessionToken} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}