import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/components/api';

export default function LessonDiagnostic({ student, sessionToken }) {
    const [diagnosticData, setDiagnosticData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const runDiagnostic = async () => {
        if (!student?.email) return;
        
        setLoading(true);
        setError(null);
        try {
            const response = await api.call('diagnosticLessonEvents', {
                studentEmail: student.email,
                sessionToken
            }, sessionToken);
            setDiagnosticData(response);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="w-5 h-5 text-amber-600" />
                <h3 className="font-semibold text-gray-900">Lesson Events Diagnostic</h3>
            </div>
            
            <p className="text-sm text-gray-600 mb-4">
                Student: <span className="font-medium">{student?.email}</span>
            </p>

            <Button
                onClick={runDiagnostic}
                disabled={loading}
                variant="outline"
                className="mb-4"
            >
                {loading ? 'Checking...' : 'Check Lesson Events'}
            </Button>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            {diagnosticData && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 bg-white p-3 rounded border border-gray-200">
                        <div>
                            <p className="text-xs text-gray-500 uppercase">Total Events</p>
                            <p className="text-2xl font-bold text-gray-900">{diagnosticData.totalEvents}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 uppercase">Lesson Events</p>
                            <p className="text-2xl font-bold text-blue-600">{diagnosticData.lessonCompletedCount}</p>
                        </div>
                    </div>

                    <div className="bg-white p-3 rounded border border-gray-200">
                        <p className="text-sm font-semibold text-gray-900 mb-2">Event Type Breakdown</p>
                        <div className="space-y-1">
                            {Object.entries(diagnosticData.eventCounts).map(([type, count]) => (
                                <div key={type} className="flex justify-between text-sm">
                                    <span className="text-gray-600">{type}</span>
                                    <span className="font-medium text-gray-900">{count}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {diagnosticData.sampleLessonPayloads.length > 0 && (
                        <div className="bg-white p-3 rounded border border-gray-200">
                            <p className="text-sm font-semibold text-gray-900 mb-2">Sample Lesson Events (Latest 3)</p>
                            <div className="space-y-2">
                                {diagnosticData.sampleEvents.map((evt, idx) => (
                                    <div key={idx} className="text-xs bg-gray-50 p-2 rounded border border-gray-100">
                                        <div className="font-medium text-gray-900">{evt.contentTitle}</div>
                                        <div className="text-gray-600">Course: {evt.courseName}</div>
                                        <div className="text-gray-500">
                                            {new Date(evt.occurredAt).toLocaleString()} ({evt.source})
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}