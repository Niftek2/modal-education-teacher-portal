import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Admin-only: Import Thinkific quiz export CSV
 * 
 * Expected columns: Course Name, Survey/Quiz Name, Student Email, Date Completed (UTC), % Score
 * Transforms to ActivityEvent format and imports via importHistoricalActivityCSV
 */

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let insideQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

function parseThinkificDate(dateStr) {
    // Parse "May 28, 2025 18:54" to ISO 8601
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
            throw new Error('Invalid date');
        }
        return date.toISOString();
    } catch {
        return new Date().toISOString();
    }
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        // Only nadia.todhh@gmail.com can use CSV import
        if (user?.email?.toLowerCase() !== 'nadia.todhh@gmail.com') {
            return Response.json({ error: 'Forbidden: CSV import access denied' }, { status: 403 });
        }
        
        const body = await req.json();
        const { csvText } = body;
        
        if (!csvText || !csvText.trim()) {
            return Response.json({ error: 'CSV text required' }, { status: 400 });
        }
        
        const lines = csvText.trim().split('\n');
        const header = parseCSVLine(lines[0]);
        
        // Find column indices
        const courseNameIdx = header.indexOf('Course Name');
        const quizNameIdx = header.indexOf('Survey/Quiz Name');
        const studentEmailIdx = header.indexOf('Student Email');
        const dateCompletedIdx = header.indexOf('Date Completed (UTC)');
        const scoreIdx = header.indexOf('% Score');
        
        if (courseNameIdx === -1 || quizNameIdx === -1 || studentEmailIdx === -1 || dateCompletedIdx === -1) {
            return Response.json({ 
                error: 'CSV must have: Course Name, Survey/Quiz Name, Student Email, Date Completed (UTC)' 
            }, { status: 400 });
        }
        
        // Build transformed CSV for importHistoricalActivityCSV
        const transformedRows = ['thinkificUserId,studentEmail,eventType,contentTitle,courseName,occurredAt,% Score'];
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const fields = parseCSVLine(line);
            
            const studentEmail = fields[studentEmailIdx]?.toLowerCase().trim() || '';
            const courseName = fields[courseNameIdx] || '';
            const quizName = fields[quizNameIdx] || '';
            const dateCompleted = fields[dateCompletedIdx] || '';
            const score = fields[scoreIdx] || '';
            
            if (!studentEmail || !dateCompleted) continue;
            
            // Look up thinkificUserId from StudentProfile
            const profiles = await base44.asServiceRole.entities.StudentProfile.filter({ email: studentEmail });
            if (profiles.length === 0) {
                console.log(`[IMPORT] Skipping row ${i + 1}: no profile found for ${studentEmail}`);
                continue;
            }
            
            const thinkificUserId = profiles[0].thinkificUserId;
            const occurredAt = parseThinkificDate(dateCompleted);
            
            // Build CSV row
            transformedRows.push(`${thinkificUserId},${studentEmail},quiz_attempted,"${quizName}",${courseName},${occurredAt},${score}`);
        }
        
        // Call importHistoricalActivityCSV
        const transformedCSV = transformedRows.join('\n');
        const importResult = await base44.functions.invoke('importHistoricalActivityCSV', { csvText: transformedCSV });
        
        return Response.json(importResult.data, { status: 200 });
    } catch (error) {
        console.error('[THINKIFIC IMPORT] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});