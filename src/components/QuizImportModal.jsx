import React, { useState } from 'react';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/components/api';

export default function QuizImportModal({ onClose, onSuccess }) {
    const [importing, setImporting] = useState(false);
    const [csvText, setCsvText] = useState('');
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);

    const parseCSV = (text) => {
        const lines = text.trim().split('\n');
        if (lines.length < 2) return [];

        const headers = lines[0].split(',').map(h => h.trim());
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

    const handleFileUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            setCsvText(event.target?.result || '');
            setError(null);
            setResults(null);
        };
        reader.readAsText(file);
    };

    const handleImport = async () => {
        try {
            setError(null);
            setImporting(true);

            const csvData = parseCSV(csvText);
            if (csvData.length === 0) {
                setError('No valid CSV data found');
                setImporting(false);
                return;
            }

            const sessionToken = localStorage.getItem('modal_math_session');
            const result = await api.call('importQuizCSVWithScores', {
                csvData
            }, sessionToken);

            setResults(result);
            setCsvText('');

            if (result.success) {
                setTimeout(() => {
                    onSuccess();
                }, 1500);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setImporting(false);
        }
    };

    if (results) {
        return (
            <Dialog open onOpenChange={onClose}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Import Complete</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="flex items-start gap-3">
                            <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="font-medium text-black">{results.imported} quiz attempts imported</p>
                                <p className="text-sm text-gray-600">Successfully added to student records</p>
                            </div>
                        </div>
                        {results.duplicates > 0 && (
                            <div className="flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="font-medium text-black">{results.duplicates} duplicates skipped</p>
                                    <p className="text-sm text-gray-600">Already exist in the system</p>
                                </div>
                            </div>
                        )}
                        {results.errors && results.errors.length > 0 && (
                            <div className="flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="font-medium text-black">{results.errors.length} rows had errors</p>
                                    <p className="text-sm text-gray-600">Check CSV format and try again</p>
                                </div>
                            </div>
                        )}
                        <Button onClick={onClose} className="w-full bg-purple-900 hover:bg-purple-800 text-white">
                            Done
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Import Historical Quiz Data</DialogTitle>
                    <DialogDescription>
                        Upload Thinkific quiz responses CSV to add historical quiz attempts
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <div className="flex gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-red-700">{error}</p>
                    </div>
                )}

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-black mb-2">
                            Choose CSV file or paste data
                        </label>
                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors cursor-pointer"
                             onClick={() => document.getElementById('csvInput')?.click()}>
                            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                            <p className="text-sm text-gray-600">Click to upload or drag and drop</p>
                            <input
                                id="csvInput"
                                type="file"
                                accept=".csv"
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                        </div>
                    </div>

                    {csvText && (
                        <div>
                            <label className="block text-sm font-medium text-black mb-2">
                                CSV Preview ({csvText.split('\n').length - 1} rows)
                            </label>
                            <textarea
                                value={csvText}
                                onChange={(e) => setCsvText(e.target.value)}
                                className="w-full h-40 p-3 border border-gray-300 rounded-lg text-xs font-mono bg-gray-50"
                                placeholder="Your CSV data will appear here"
                            />
                        </div>
                    )}

                    <div className="flex gap-2">
                        <Button
                            onClick={onClose}
                            variant="outline"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleImport}
                            disabled={!csvText || importing}
                            className="flex-1 bg-purple-900 hover:bg-purple-800 text-white"
                        >
                            {importing ? 'Importing...' : 'Import'}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}