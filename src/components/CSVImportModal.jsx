import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertCircle, Upload } from 'lucide-react';
import { api } from '@/components/api';

export default function CSVImportModal({ isOpen, onClose, sessionToken }) {
    const [csvText, setCsvText] = useState('');
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    const handleFileUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            setCsvText(event.target?.result || '');
        };
        reader.readAsText(file);
    };

    const parseCSV = (text) => {
        const lines = text.trim().split('\n');
        if (lines.length < 2) return [];

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const row = {};
            headers.forEach((header, idx) => {
                row[header] = values[idx] || '';
            });
            rows.push(row);
        }

        return rows;
    };

    const handleImport = async () => {
        try {
            setError('');
            setImporting(true);

            if (!csvText || !csvText.trim()) {
                setError('CSV content is required');
                return;
            }

            const response = await api.call('importThinkificQuizExport', { csvText }, sessionToken);

            setResult(response);
        } catch (err) {
            setError(err.message || 'Import failed');
        } finally {
            setImporting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Import Student Activity CSV</DialogTitle>
                    <DialogDescription>
                        Upload a quiz export CSV file to import historical student activity data
                    </DialogDescription>
                </DialogHeader>

                {result ? (
                    <div className="space-y-4">
                        <div className={`p-4 rounded-lg ${result.added > 0 ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                            <p className="font-semibold text-black mb-2">Import Results</p>
                            <div className="space-y-1 text-sm">
                                <p>✓ Added: {result.added}</p>
                                <p>- CSV duplicates skipped: {result.skippedDuplicates}</p>
                                <p>- Webhook duplicates skipped: {result.skippedAsWebhookDuplicate}</p>
                                {result.errors && result.errors.length > 0 && <p>✗ Errors: {result.errors.length}</p>}
                            </div>
                        </div>
                        {result.errors && result.errors.length > 0 && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-h-40 overflow-y-auto">
                                <p className="text-sm font-semibold text-red-800 mb-2">Errors:</p>
                                <ul className="text-xs text-red-700 space-y-1">
                                    {result.errors.map((err, i) => (
                                        <li key={i}>• {err}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <div className="flex gap-2">
                            <Button onClick={() => { setCsvText(''); setResult(null); }} variant="outline">Import Another</Button>
                            <Button onClick={onClose} className="bg-green-600 hover:bg-green-700 text-white">Done</Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
                                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                                <p className="text-sm text-red-800">{error}</p>
                            </div>
                        )}

                        <div className="relative">
                            <input
                                type="file"
                                accept=".csv"
                                onChange={handleFileUpload}
                                className="hidden"
                                id="csv-upload"
                            />
                            <label 
                                htmlFor="csv-upload" 
                                className="flex flex-col items-center justify-center border-2 border-dashed border-purple-300 rounded-lg p-8 bg-purple-50 hover:bg-purple-100 cursor-pointer transition-colors"
                            >
                                <div className="w-12 h-12 rounded-full bg-purple-900 flex items-center justify-center mb-3">
                                    <Upload className="w-6 h-6 text-white" />
                                </div>
                                <p className="text-sm font-semibold text-purple-900 mb-1">
                                    {csvText ? '✓ File loaded successfully' : 'Upload CSV File'}
                                </p>
                                <p className="text-xs text-gray-600">
                                    Click to browse or drag and drop
                                </p>
                            </label>
                        </div>

                        <textarea
                            value={csvText}
                            onChange={(e) => setCsvText(e.target.value)}
                            placeholder="Or paste CSV content here..."
                            className="w-full h-40 p-3 border border-gray-300 rounded-lg font-mono text-sm"
                        />

                        <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 border border-gray-200">
                            <p className="font-semibold mb-2 text-gray-700">Expected CSV format:</p>
                            <code className="block overflow-x-auto whitespace-pre text-gray-600">Course Name,Survey/Quiz Name,Student Email,Date Completed (UTC),% Score
L2,Adding Quiz,student@example.com,"February 12, 2026 16:31",85
PK,Quiz 1,student@example.com,"February 11, 2026 14:20",92</code>
                        </div>

                        <div className="flex gap-2 justify-end">
                            <Button onClick={onClose} variant="outline">Cancel</Button>
                            <Button
                                onClick={handleImport}
                                disabled={!csvText || importing}
                                className="bg-purple-900 hover:bg-purple-800 text-white"
                            >
                                {importing ? 'Importing...' : 'Import'}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}