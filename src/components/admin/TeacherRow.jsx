import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Users, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import GroupManagePanel from './GroupManagePanel';

export default function TeacherRow({ teacher, sessionToken, onRefresh }) {
    const [expanded, setExpanded] = useState(false);

    const activeCount = teacher.dbStudents.filter(s => s.status === 'active').length;
    const archivedCount = teacher.dbStudents.filter(s => s.status === 'archived').length;
    const thinkificCount = teacher.thinkificStudents?.length || 0;
    const inSync = activeCount === thinkificCount;

    return (
        <div className="border border-gray-200 rounded-xl overflow-hidden mb-3">
            <div
                className="flex items-center gap-4 px-5 py-4 bg-white cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{teacher.email}</p>
                    <div className="flex gap-4 mt-1 text-xs text-gray-500">
                        <span>DB Active: <strong className="text-gray-800">{activeCount}</strong></span>
                        <span>DB Archived: <strong className="text-gray-800">{archivedCount}</strong></span>
                        <span>Thinkific Group: <strong className="text-gray-800">{thinkificCount}</strong></span>
                        {teacher.groups?.[0]?.groupName && (
                            <span>Group: <strong className="text-gray-800">{teacher.groups[0].groupName}</strong></span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {inSync ? (
                        <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" /> In Sync
                        </span>
                    ) : (
                        <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                            <AlertCircle className="w-3 h-3" /> Out of Sync
                        </span>
                    )}
                    {expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                </div>
            </div>

            {expanded && (
                <div className="border-t border-gray-100 bg-gray-50 p-5">
                    {teacher.groups?.length === 0 ? (
                        <p className="text-sm text-amber-600">⚠ No Thinkific group linked for this teacher.</p>
                    ) : (
                        teacher.groups.map(g => (
                            <GroupManagePanel
                                key={g.groupId}
                                group={g}
                                teacher={teacher}
                                sessionToken={sessionToken}
                                onRefresh={onRefresh}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}