import React, { useState, useEffect } from 'react';
import { Copy, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/components/api';

export default function SnapshotModal({ sessionToken, onClose }) {
    const [snapshot, setSnapshot] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        loadSnapshot();
    }, []);

    const loadSnapshot = async () => {
        try {
            setLoading(true);
            const response = await api.call('teacherSnapshot', {}, sessionToken);
            setSnapshot(response);
            setError(null);
        } catch (err) {
            setError(err.message);
            setSnapshot(null);
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = () => {
        const json = JSON.stringify(snapshot, null, 2);
        navigator.clipboard.writeText(json);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Teacher Snapshot Diagnostics</DialogTitle>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader className="w-6 h-6 text-gray-600 animate-spin" />
                    </div>
                ) : error ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                        {error}
                    </div>
                ) : snapshot ? (
                    <div className="space-y-4">
                        <Button
                            onClick={copyToClipboard}
                            className="w-full bg-purple-900 hover:bg-purple-800 text-white"
                        >
                            <Copy className="w-4 h-4 mr-2" />
                            {copied ? 'Copied!' : 'Copy JSON to Clipboard'}
                        </Button>

                        <div className="space-y-4">
                            <div>
                                <h3 className="font-semibold text-sm mb-2">User</h3>
                                <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto border border-gray-200">
                                    {JSON.stringify(snapshot.user, null, 2)}
                                </pre>
                            </div>

                            <div>
                                <h3 className="font-semibold text-sm mb-2">Summary</h3>
                                <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto border border-gray-200">
                                    {JSON.stringify(snapshot.summary, null, 2)}
                                </pre>
                            </div>

                            <div>
                                <h3 className="font-semibold text-sm mb-2">Webhooks (Last 24h)</h3>
                                <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto border border-gray-200">
                                    {JSON.stringify(snapshot.webhooks, null, 2)}
                                </pre>
                            </div>

                            <div>
                                <h3 className="font-semibold text-sm mb-2">Activity Events (Last 24h)</h3>
                                <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto border border-gray-200">
                                    {JSON.stringify(snapshot.activity, null, 2)}
                                </pre>
                            </div>

                            <div>
                                <h3 className="font-semibold text-sm mb-2">Per-Student Sample (Top 50)</h3>
                                <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto border border-gray-200 max-h-64">
                                    {JSON.stringify(snapshot.perStudentSample, null, 2)}
                                </pre>
                            </div>
                        </div>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}