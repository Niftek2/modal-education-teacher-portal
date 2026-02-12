import React, { useState } from 'react';
import { X, Plus, Trash2, CheckCircle2, Copy } from 'lucide-react';
import { api } from '@/components/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

export default function AddStudentModal({ groupId, onClose, onSuccess }) {
    const [students, setStudents] = useState([{ firstName: '', lastInitial: '' }]);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState(null);

    const addStudentField = () => {
        if (students.length < 10) {
            setStudents([...students, { firstName: '', lastInitial: '' }]);
        }
    };

    const removeStudentField = (index) => {
        setStudents(students.filter((_, i) => i !== index));
    };

    const updateStudent = (index, field, value) => {
        const updated = [...students];
        updated[index][field] = value;
        setStudents(updated);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        const valid = students.filter(s => s.firstName && s.lastInitial);
        if (valid.length === 0) {
            alert('Please enter at least one student');
            return;
        }

        try {
            setLoading(true);
            const sessionToken = localStorage.getItem('modal_math_session');
            
            const response = await api.call('addStudents', {
                students: valid,
                groupId: groupId,
                sessionToken
            }, sessionToken);

            setResults(response.results);
        } catch (error) {
            console.error('Add students error:', error);
            alert('Failed to add students');
        } finally {
            setLoading(false);
        }
    };

    const copyCredentials = (student) => {
        const text = `Email: ${student.email}\nPassword: ${student.password}`;
        navigator.clipboard.writeText(text);
    };

    const handleClose = () => {
        if (results) {
            onSuccess();
        }
        onClose();
    };

    if (results) {
        return (
            <Dialog open={true} onOpenChange={handleClose}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Students Added</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-3">
                        {results.map((result, idx) => (
                            <div
                                key={idx}
                                className={`p-4 rounded-lg border ${
                                    result.success
                                        ? 'bg-green-50 border-green-200'
                                        : 'bg-red-50 border-red-200'
                                }`}
                            >
                                {result.success ? (
                                    <>
                                        <div className="flex items-start justify-between mb-2">
                                            <div>
                                                <p className="font-medium text-black">
                                                    {result.student.firstName} {result.student.lastInitial}
                                                </p>
                                                <p className="text-sm text-gray-600">{result.student.email}</p>
                                            </div>
                                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                                        </div>
                                        <div className="bg-white border border-green-200 rounded p-3 mt-2">
                                            <p className="text-xs text-gray-600 mb-1">Login Credentials:</p>
                                            <p className="text-sm font-mono text-black">Password: {result.student.password}</p>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => copyCredentials(result.student)}
                                                className="mt-2 h-8 text-xs"
                                            >
                                                <Copy className="w-3 h-3 mr-1" />
                                                Copy
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <div>
                                        <p className="font-medium text-red-800">
                                            {result.firstName} - Failed
                                        </p>
                                        <p className="text-sm text-red-600">{result.error}</p>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
                        <p className="text-sm text-yellow-900 font-medium mb-1">
                            Important: Save These Credentials
                        </p>
                        <p className="text-xs text-yellow-800">
                            Make sure to copy and save the login credentials. Students should change their password after first login.
                        </p>
                    </div>

                    <Button onClick={handleClose} className="w-full bg-purple-900 hover:bg-purple-800">
                        Done
                    </Button>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Add Students</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {students.map((student, index) => (
                        <div key={index} className="flex gap-3 items-start">
                            <div className="flex-1">
                                <Input
                                    placeholder="First Name"
                                    value={student.firstName}
                                    onChange={(e) => updateStudent(index, 'firstName', e.target.value)}
                                    className="border-gray-300"
                                />
                            </div>
                            <div className="w-24">
                                <Input
                                    placeholder="Last Initial"
                                    value={student.lastInitial}
                                    onChange={(e) => updateStudent(index, 'lastInitial', e.target.value)}
                                    maxLength={1}
                                    className="border-gray-300"
                                />
                            </div>
                            {students.length > 1 && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeStudentField(index)}
                                    className="text-gray-400 hover:text-red-600"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            )}
                        </div>
                    ))}

                    {students.length < 10 && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={addStudentField}
                            className="w-full border-dashed"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Add Another Student ({students.length}/10)
                        </Button>
                    )}

                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <p className="text-sm text-gray-700 mb-2">
                            <strong>Auto-generated credentials:</strong>
                        </p>
                        <ul className="text-xs text-gray-600 space-y-1">
                            <li>• Email: firstname + lastinitial + random digits + @modalmath.com</li>
                            <li>• Password: Math1234!</li>
                            <li>• Students will be enrolled in the Student bundle</li>
                        </ul>
                    </div>

                    <div className="flex gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            className="flex-1"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={loading}
                            className="flex-1 bg-purple-900 hover:bg-purple-800"
                        >
                            {loading ? 'Adding...' : `Add ${students.filter(s => s.firstName && s.lastInitial).length} Student(s)`}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}