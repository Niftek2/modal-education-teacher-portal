import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Edit2, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/components/api';

const COURSE_LEVEL_MAP = {
    '422595': 'PK',
    '422618': 'K',
    '422620': 'L1',
    '496294': 'L2',
    '496295': 'L3',
    '496297': 'L4',
    '496298': 'L5',
};

function resolveLevel(item) {
    const fromCourse = item.courseId && COURSE_LEVEL_MAP[String(item.courseId)];
    return fromCourse || item.level || '—';
}

export default function ManageCatalog() {
    const [loading, setLoading] = useState(true);
    const [catalog, setCatalog] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [formData, setFormData] = useState({
        title: '',
        level: 'Elementary',
        type: 'lesson',
        courseId: '',
        lessonId: '',
        quizId: '',
        thinkificUrl: '',
        isActive: true
    });
    const navigate = useNavigate();

    useEffect(() => {
        const sessionToken = localStorage.getItem('modal_math_session');
        if (!sessionToken) {
            navigate('/Home');
            return;
        }
        loadCatalog(sessionToken);
    }, []);

    const loadCatalog = async (sessionToken) => {
        try {
            setLoading(true);
            const result = await api.call('manageCatalog', {
                sessionToken,
                action: 'list'
            }, sessionToken);
            setCatalog(result.catalog || []);
        } catch (error) {
            console.error('Load catalog error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const sessionToken = localStorage.getItem('modal_math_session');

        try {
            await api.call('manageCatalog', {
                sessionToken,
                action: editingItem ? 'update' : 'create',
                catalogId: editingItem?.id,
                data: formData
            }, sessionToken);

            setShowModal(false);
            setEditingItem(null);
            setFormData({
                title: '',
                level: 'Elementary',
                type: 'lesson',
                courseId: '',
                lessonId: '',
                quizId: '',
                thinkificUrl: '',
                isActive: true
            });
            loadCatalog(sessionToken);
        } catch (error) {
            console.error('Save error:', error);
            alert('Failed to save catalog item');
        }
    };

    const handleToggle = async (item) => {
        const sessionToken = localStorage.getItem('modal_math_session');
        try {
            await api.call('manageCatalog', {
                sessionToken,
                action: 'toggle',
                catalogId: item.id
            }, sessionToken);
            loadCatalog(sessionToken);
        } catch (error) {
            console.error('Toggle error:', error);
        }
    };

    const openEditModal = (item) => {
        setEditingItem(item);
        setFormData({
            title: item.title,
            level: item.level,
            type: item.type,
            courseId: item.courseId || '',
            lessonId: item.lessonId || '',
            quizId: item.quizId || '',
            thinkificUrl: item.thinkificUrl,
            isActive: item.isActive
        });
        setShowModal(true);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-900 rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading catalog...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white">
            <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            onClick={() => navigate('/Dashboard')}
                            className="text-gray-600 hover:text-black"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back
                        </Button>
                        <h1 className="text-2xl font-bold text-black">Manage Assignment Catalog</h1>
                    </div>
                    <Button
                        onClick={() => {
                            setEditingItem(null);
                            setFormData({
                                title: '',
                                level: 'Elementary',
                                type: 'lesson',
                                courseId: '',
                                lessonId: '',
                                quizId: '',
                                thinkificUrl: '',
                                isActive: true
                            });
                            setShowModal(true);
                        }}
                        className="bg-purple-900 hover:bg-purple-800"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Item
                    </Button>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Level</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Title</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Type</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Lesson ID</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Status</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {catalog.map((item) => (
                                <tr key={item.id} className="border-b border-gray-100">
                                    <td className="px-4 py-3 text-sm text-gray-900">{item.level}</td>
                                    <td className="px-4 py-3 text-sm text-gray-900">{item.title}</td>
                                    <td className="px-4 py-3 text-sm text-gray-600">{item.type}</td>
                                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">{item.lessonId || '-'}</td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                                            item.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                        }`}>
                                            {item.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => openEditModal(item)}
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleToggle(item)}
                                            >
                                                {item.isActive ? (
                                                    <ToggleRight className="w-5 h-5 text-green-600" />
                                                ) : (
                                                    <ToggleLeft className="w-5 h-5 text-gray-400" />
                                                )}
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </main>

            <Dialog open={showModal} onOpenChange={setShowModal}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editingItem ? 'Edit' : 'Add'} Catalog Item</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-2">Title</label>
                            <Input
                                value={formData.title}
                                onChange={(e) => setFormData({...formData, title: e.target.value})}
                                required
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Level</label>
                                <Input
                                    value={formData.level}
                                    onChange={(e) => setFormData({...formData, level: e.target.value})}
                                    placeholder="PK, K, L1, L2, etc."
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2">Type</label>
                                <Select value={formData.type} onValueChange={(v) => setFormData({...formData, type: v})}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="lesson">Lesson</SelectItem>
                                        <SelectItem value="quiz">Quiz</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">Lesson ID (preferred for matching)</label>
                            <Input
                                value={formData.lessonId}
                                onChange={(e) => setFormData({...formData, lessonId: e.target.value})}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Course ID (optional)</label>
                                <Input
                                    value={formData.courseId}
                                    onChange={(e) => setFormData({...formData, courseId: e.target.value})}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2">Quiz ID (optional)</label>
                                <Input
                                    value={formData.quizId}
                                    onChange={(e) => setFormData({...formData, quizId: e.target.value})}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">Thinkific URL</label>
                            <Input
                                value={formData.thinkificUrl}
                                onChange={(e) => setFormData({...formData, thinkificUrl: e.target.value})}
                                placeholder="https://..."
                                required
                            />
                        </div>
                        <div className="flex gap-3 justify-end">
                            <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" className="bg-purple-900 hover:bg-purple-800">
                                {editingItem ? 'Update' : 'Create'}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}