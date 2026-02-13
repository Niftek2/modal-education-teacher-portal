import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Plus, CheckCircle2, AlertCircle } from 'lucide-react';

export default function RequestHistory() {
    const navigate = useNavigate();
    const [teacher, setTeacher] = useState(null);
    const [students, setStudents] = useState([{ firstName: '', lastInitial: '' }]);
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const checkAuth = async () => {
            const sessionToken = localStorage.getItem('modal_math_session');
            if (!sessionToken) {
                navigate('/');
                return;
            }

            try {
                const response = await base44.functions.invoke('getTeacherData', { sessionToken });
                setTeacher(response.data);
            } catch (err) {
                console.error('Failed to load teacher data:', err);
                navigate('/');
            }
        };

        checkAuth();
    }, [navigate]);

    const handleAddStudent = () => {
        if (students.length < 10) {
            setStudents([...students, { firstName: '', lastInitial: '' }]);
        }
    };

    const handleRemoveStudent = (index) => {
        setStudents(students.filter((_, i) => i !== index));
    };

    const handleStudentChange = (index, field, value) => {
        const updated = [...students];
        updated[index][field] = value;
        setStudents(updated);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const validStudents = students.filter(s => s.firstName.trim() && s.lastInitial.trim());
            
            if (!validStudents.length) {
                setError('Please enter at least one student');
                setLoading(false);
                return;
            }

            const studentList = validStudents
                .map(s => `${s.firstName} ${s.lastInitial}`)
                .join('\n');

            const emailBody = `Student History Request

Teacher Name: ${teacher.full_name}
Teacher Email: ${teacher.email}

Students Requested:
${studentList}`;

            await base44.integrations.Core.SendEmail({
                to: 'contact@modalmath.com',
                subject: '[Student History Request]',
                body: emailBody
            });

            setSubmitted(true);
            setTimeout(() => {
                navigate('/Dashboard');
            }, 2000);
        } catch (err) {
            setError(err.message || 'Failed to send request');
        } finally {
            setLoading(false);
        }
    };

    if (!teacher) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-6">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-900 rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading...</p>
                </div>
            </div>
        );
    }

    if (submitted) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-6">
                <div className="max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 className="w-8 h-8 text-purple-900" />
                    </div>
                    <h1 className="text-3xl font-semibold text-black mb-3">Request Sent</h1>
                    <p className="text-gray-600 mb-6">
                        Your student history request has been sent to our support team. You'll be redirected to the dashboard.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white p-6">
            <div className="max-w-2xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-black mb-2">Request Student History</h1>
                    <p className="text-gray-600">Submit a request for historical records of your students</p>
                </div>

                <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm space-y-6">
                    {/* Teacher Information */}
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-black">Your Information</h2>
                        <div>
                            <label className="block text-sm font-medium text-black mb-2">Name</label>
                            <Input
                                type="text"
                                value={teacher.full_name}
                                disabled
                                className="bg-gray-50 text-gray-600"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-black mb-2">Email</label>
                            <Input
                                type="email"
                                value={teacher.email}
                                disabled
                                className="bg-gray-50 text-gray-600"
                            />
                        </div>
                    </div>

                    {/* Students */}
                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-black">Students</h2>
                        <div className="space-y-3">
                            {students.map((student, index) => (
                                <div key={index} className="flex gap-3">
                                    <Input
                                        type="text"
                                        placeholder="First Name"
                                        value={student.firstName}
                                        onChange={(e) => handleStudentChange(index, 'firstName', e.target.value)}
                                        className="flex-1"
                                    />
                                    <Input
                                        type="text"
                                        placeholder="Last Initial"
                                        value={student.lastInitial}
                                        onChange={(e) => handleStudentChange(index, 'lastInitial', e.target.value.slice(0, 1))}
                                        maxLength="1"
                                        className="w-20"
                                    />
                                    {students.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveStudent(index)}
                                            className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {students.length < 10 && (
                            <button
                                type="button"
                                onClick={handleAddStudent}
                                className="flex items-center gap-2 text-purple-900 hover:text-purple-800 font-medium text-sm"
                            >
                                <Plus className="w-4 h-4" />
                                Add Another Student
                            </button>
                        )}
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
                            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-800">{error}</p>
                        </div>
                    )}

                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={() => navigate('/Dashboard')}
                            className="flex-1 border border-gray-300 text-black font-medium py-2 px-4 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <Button
                            type="submit"
                            disabled={loading}
                            className="flex-1 bg-purple-900 hover:bg-purple-800 text-white font-medium py-2 px-4 rounded-lg"
                        >
                            {loading ? 'Sending...' : 'Send Request'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}