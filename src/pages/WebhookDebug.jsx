import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/components/api';

export default function WebhookDebug() {
    const [webhookLogs, setWebhookLogs] = useState([]);
    const [activityEvents, setActivityEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const sessionToken = localStorage.getItem('modal_math_session');
            
            // Load webhook logs
            const logsResponse = await api.call('debugWebhooks', { sessionToken }, sessionToken);
            setWebhookLogs(logsResponse.logs || []);
            
            // Load activity events
            const eventsResponse = await api.call('getRecentActivity', { limit: 50, sessionToken }, sessionToken);
            setActivityEvents(eventsResponse.events || []);
            
        } catch (error) {
            console.error('Failed to load webhook debug data:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-900 rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white">
            <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button
                            onClick={() => navigate('/dashboard')}
                            variant="ghost"
                            className="text-gray-600"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back
                        </Button>
                        <h1 className="text-2xl font-bold text-black">Webhook Debug</h1>
                    </div>
                    <Button onClick={loadData} variant="outline">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Refresh
                    </Button>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                {/* Webhook Endpoint Info */}
                <div className="bg-gray-50 rounded-xl p-6 border border-gray-200 mb-8">
                    <h2 className="text-lg font-semibold text-black mb-2">Webhook Endpoint</h2>
                    <code className="text-sm text-gray-700 bg-white px-3 py-2 rounded border border-gray-300 block">
                        https://modalteacher.base44.app/api/apps/698c9549de63fc919dec560c/functions/webhooks/thinkific
                    </code>
                    <p className="text-sm text-gray-600 mt-2">
                        Configure this in Thinkific Admin → Settings → Webhooks
                    </p>
                </div>

                {/* Recent Webhook Logs */}
                <div className="mb-8">
                    <h2 className="text-xl font-semibold text-black mb-4">
                        Recent Webhook Logs ({webhookLogs.length})
                    </h2>
                    {webhookLogs.length === 0 ? (
                        <div className="bg-gray-50 rounded-xl p-8 text-center border border-gray-200">
                            <p className="text-gray-600">No webhook events received yet</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {webhookLogs.map((log) => (
                                <div key={log.id} className="bg-white rounded-lg border border-gray-200 p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-3">
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                log.status === 'ok' 
                                                    ? 'bg-green-100 text-green-800' 
                                                    : 'bg-red-100 text-red-800'
                                            }`}>
                                                {log.status}
                                            </span>
                                            <span className="font-medium text-black">{log.topic}</span>
                                        </div>
                                        <span className="text-sm text-gray-500">
                                            {new Date(log.timestamp).toLocaleString()}
                                        </span>
                                    </div>
                                    {log.errorMessage && (
                                        <div className="text-sm text-red-600 mb-2">{log.errorMessage}</div>
                                    )}
                                    <details className="text-sm">
                                        <summary className="cursor-pointer text-gray-600 hover:text-black">
                                            View payload
                                        </summary>
                                        <pre className="mt-2 bg-gray-50 rounded p-3 overflow-x-auto text-xs">
                                            {log.rawPayload}
                                        </pre>
                                    </details>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Recent Activity Events */}
                <div>
                    <h2 className="text-xl font-semibold text-black mb-4">
                        Recent Activity Events ({activityEvents.length})
                    </h2>
                    {activityEvents.length === 0 ? (
                        <div className="bg-gray-50 rounded-xl p-8 text-center border border-gray-200">
                            <p className="text-gray-600">No activity events yet</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {activityEvents.map((event) => (
                                <div key={event.id} className="bg-white rounded-lg border border-gray-200 p-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="font-medium text-black">
                                                    {event.studentDisplayName || event.studentEmail}
                                                </span>
                                                <span className="text-sm text-gray-500">•</span>
                                                <span className="text-sm text-gray-600">{event.courseName}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                                <span className="capitalize">{event.eventType.replace('_', ' ')}</span>
                                                {event.contentTitle && (
                                                    <>
                                                        <span>•</span>
                                                        <span>{event.contentTitle}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-sm text-gray-600">
                                                {new Date(event.occurredAt).toLocaleString()}
                                            </div>
                                            <div className="text-xs text-gray-500 mt-1">
                                                {event.source}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}