import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function AddHistoricalDataModal({ teacherEmail, onClose }) {
    const [magicKey, setMagicKey] = useState('');
    const [email, setEmail] = useState(teacherEmail || '');
    const [csvContent, setCsvContent] = useState(null);
    const [fileName, setFileName] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const fileRef = useRef();

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = (ev) => setCsvContent(ev.target.result);
        reader.readAsText(file);
    };

    const handleSubmit = async () => {
        if (!magicKey || !email || !csvContent) return;
        setLoading(true);
        setResult(null);
        const res = await base44.functions.invoke('ingestHistoricalData', {
            magicKey,
            teacherEmail: email,
            csvData: csvContent,
        });
        setResult(res.data);
        setLoading(false);
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
                <div className="flex items-center justify-between p-5 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">Upload Historical Data</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Teacher Email</label>
                        <Input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="teacher@example.com"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Upload Key</label>
                        <Input
                            type="password"
                            value={magicKey}
                            onChange={(e) => setMagicKey(e.target.value)}
                            placeholder="Enter your upload key"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">CSV File</label>
                        <div
                            onClick={() => fileRef.current.click()}
                            className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50 transition-colors"
                        >
                            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                            {fileName ? (
                                <p className="text-sm font-medium text-purple-700">{fileName}</p>
                            ) : (
                                <p className="text-sm text-gray-500">Click to select a CSV file</p>
                            )}
                        </div>
                        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
                    </div>

                    {result && (
                        <div className={`rounded-lg p-4 ${result.error ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                            {result.error ? (
                                <div className="flex items-start gap-2">
                                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                                    <p className="text-sm text-red-700">{result.error}</p>
                                </div>
                            ) : (
                                <div className="flex items-start gap-2">
                                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-sm font-medium text-green-800">
                                            Import complete: {result.created} records created, {result.skipped} skipped.
                                        </p>
                                        {result.errors?.length > 0 && (
                                            <ul className="mt-2 space-y-1">
                                                {result.errors.map((e, i) => (
                                                    <li key={i} className="text-xs text-red-600">{e}</li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 p-5 border-t">
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!magicKey || !email || !csvContent || loading}
                        className="bg-[#632a8c] hover:bg-[#7b35ae] text-white"
                    >
                        {loading ? 'Uploading...' : 'Upload'}
                    </Button>
                </div>
            </div>
        </div>
    );
}