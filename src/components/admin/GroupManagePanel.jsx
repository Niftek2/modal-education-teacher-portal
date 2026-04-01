import React, { useState } from 'react';
import { RefreshCw, UserPlus, UserMinus, Loader2, Pencil, Trash2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/components/api';
import StudentEnrollmentPanel from './StudentEnrollmentPanel';

export default function GroupManagePanel({ group, teacher, sessionToken, onRefresh }) {
    const [syncing, setSyncing] = useState(false);
    const [addEmail, setAddEmail] = useState('');
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState(null);
    const [message, setMessage] = useState(null);

    // Group rename state
    const [renaming, setRenaming] = useState(false);
    const [newName, setNewName] = useState('');
    const [renameSaving, setRenameSaving] = useState(false);

    // Group delete state
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const showMsg = (text, isError = false) => {
        setMessage({ text, isError });
        setTimeout(() => setMessage(null), 4000);
    };

    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await api.call('adminManageGroup', {
                action: 'sync',
                teacherEmail: teacher.email,
                groupId: group.groupId,
            }, sessionToken);
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

    const handleRename = async () => {
        if (!newName.trim() || newName.trim() === group.groupName) { setRenaming(false); return; }
        setRenameSaving(true);
        try {
            await api.call('adminManageGroupMeta', {
                action: 'rename',
                groupId: group.groupId,
                newName: newName.trim(),
            }, sessionToken);
            showMsg(`Group renamed to "${newName.trim()}"`);
            setRenaming(false);
            onRefresh();
        } catch (e) {
            showMsg(e.message, true);
        } finally {
            setRenameSaving(false);
        }
    };

    const handleDeleteGroup = async () => {
        setDeleting(true);
        try {
            await api.call('adminManageGroupMeta', {
                action: 'delete',
                groupId: group.groupId,
            }, sessionToken);
            showMsg(`Group deleted.`);
            setConfirmDelete(false);
            onRefresh();
        } catch (e) {
            showMsg(e.message, true);
        } finally {
            setDeleting(false);
        }
    };

    const thinkificStudents = (teacher.thinkificStudents || []).filter(s => s.groupId === group.groupId);
    const activeDbStudents = teacher.dbStudents.filter(s => s.status === 'active');
    const thinkificEmails = new Set(thinkificStudents.map(s => s.email));
    const missingFromThinkific = activeDbStudents.filter(s => !thinkificEmails.has(s.email?.toLowerCase()));

    return (
        <div className="space-y-4">
            {/* Group header */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
                {renaming ? (
                    <div className="flex items-center gap-2 flex-1">
                        <Input
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            className="h-7 text-sm max-w-xs"
                            autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}
                        />
                        <button onClick={handleRename} disabled={renameSaving} className="text-green-600 hover:text-green-800">
                            {renameSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button onClick={() => setRenaming(false)} className="text-gray-400 hover:text-gray-600">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <h4 className="font-semibold text-sm text-gray-700 truncate">
                            Group: <span className="text-purple-800">{group.groupName}</span>
                            <span className="ml-2 text-gray-400 font-normal">ID: {group.groupId}</span>
                        </h4>
                        <button
                            onClick={() => { setNewName(group.groupName); setRenaming(true); }}
                            className="text-gray-400 hover:text-purple-700 flex-shrink-0"
                            title="Rename group"
                        >
                            <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {confirmDelete ? (
                            <span className="flex items-center gap-1 text-xs text-red-600">
                                Delete?
                                <button onClick={handleDeleteGroup} disabled={deleting} className="font-semibold hover:underline">
                                    {deleting ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Yes'}
                                </button>
                                <button onClick={() => setConfirmDelete(false)} className="text-gray-400 hover:text-gray-600 ml-1">
                                    <X className="w-3 h-3" />
                                </button>
                            </span>
                        ) : (
                            <button
                                onClick={() => setConfirmDelete(true)}
                                className="text-gray-300 hover:text-red-500 flex-shrink-0"
                                title="Delete group"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                )}
                <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSync}
                    disabled={syncing}
                    className="border-purple-300 text-purple-700 hover:bg-purple-50 flex-shrink-0"
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
                                    disabled={!!removing}
                                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                    title="Remove from group"
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