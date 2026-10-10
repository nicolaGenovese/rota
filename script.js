const STORAGE_KEY = 'turniSettimanali';
const DATE_RANGE_STORAGE_KEY = 'turniSettimanaliDateRange';
const LOCAL_LAST_EDITED_KEY = 'turniSettimanaliLastEdited';
const SUPABASE_URL = 'https://sudysoizwfddpladkzeo.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kcmzYpi72KPwt1aI_SOyVQ_-J2FpTqR';
const SUPABASE_TABLE = 'weekly_schedules';
const PUBLIC_SCHEDULE_OWNER_ID = '1c3d3e6c-6dbe-4418-b8d6-3e3251b407a9';
let supabaseClient = null;
let scheduleEditedSinceLoad = false;
let canEditSchedule = false;
const DAYS = [
    { label: 'Monday', totalId: 'mon-total' },
    { label: 'Tuesday', totalId: 'tue-total' },
    { label: 'Wednesday', totalId: 'wed-total' },
    { label: 'Thursday', totalId: 'thu-total' },
    { label: 'Friday', totalId: 'fri-total' },
    { label: 'Saturday', totalId: 'sat-total' },
    { label: 'Sunday', totalId: 'sun-total' }
];

const DEFAULT_EMPLOYEES = [
    { name: 'John Smith', shifts: ['', '09:00-17:00', '09:00-17:00', '09:00-17:00', '09:00-17:00', '09:00-17:00', ''] },
    { name: 'Sarah Johnson', shifts: ['', '', '12:00-20:00', '12:00-20:00', '12:00-20:00', '12:00-20:00', '12:00-20:00'] },
    { name: '', shifts: Array(7).fill('') },
    { name: '', shifts: Array(7).fill('') },
    { name: '', shifts: Array(7).fill('') },
    { name: '', shifts: Array(7).fill('') },
    { name: '', shifts: Array(7).fill('') }
];

document.addEventListener('DOMContentLoaded', initializeSchedule);

function initializeSchedule() {
    const savedData = readSavedSchedule();
    renderRows(savedData || DEFAULT_EMPLOYEES);
    initializeDateRange();
    setScheduleAccess(false);

    document.getElementById('scheduleBody').addEventListener('input', () => {
        scheduleEditedSinceLoad = true;
        calculateTotals();
        saveSchedule();
    });
    document.getElementById('saveButton').addEventListener('click', saveToSupabase);
    document.getElementById('pdfDownloadButton').addEventListener('click', generatePdfDownload);
    document.getElementById('excelButton').addEventListener('click', generateExcel);
    document.getElementById('pdfPrintButton').addEventListener('click', () => window.print());
    document.getElementById('clearButton').addEventListener('click', clearAll);
    calculateTotals();
    restoreSupabaseSchedule();
}

function readSavedSchedule() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return null;

        const rows = JSON.parse(saved);
        if (!Array.isArray(rows)) return null;
        return Array.from({ length: 7 }, (_, index) => {
            const row = rows[index] || {};
            return {
                name: typeof row.name === 'string' ? row.name : '',
                shifts: DAYS.map((_, dayIndex) => Array.isArray(row.shifts) && typeof row.shifts[dayIndex] === 'string' ? row.shifts[dayIndex] : '')
            };
        });
    } catch (error) {
        return null;
    }
}

function renderRows(employees) {
    const body = document.getElementById('scheduleBody');
    body.replaceChildren();

    employees.forEach((employee, rowIndex) => {
        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'employee-input';
        nameInput.placeholder = `Employee ${rowIndex + 1}`;
        nameInput.setAttribute('aria-label', `Employee name ${rowIndex + 1}`);
        nameInput.value = employee.name || '';
        nameCell.append(nameInput);
        row.append(nameCell);

        DAYS.forEach((day, dayIndex) => {
            const cell = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'shift-input';
            input.placeholder = '00:00-00:00';
        input.setAttribute('aria-label', `${day.label}, employee ${rowIndex + 1}`);
            input.value = employee.shifts?.[dayIndex] || '';
            cell.append(input);
            row.append(cell);
        });

        const totalCell = document.createElement('td');
        totalCell.className = 'weekly-total';
        totalCell.textContent = '0,0';
        row.append(totalCell);
        body.append(row);
    });
}

function collectSchedule() {
    return Array.from(document.querySelectorAll('#scheduleBody tr'), row => ({
        name: row.querySelector('.employee-input').value.trim(),
        shifts: Array.from(row.querySelectorAll('.shift-input'), input => input.value.trim())
    }));
}

function saveSchedule() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collectSchedule()));
        localStorage.setItem(LOCAL_LAST_EDITED_KEY, new Date().toISOString());
        clearMessage();
    } catch (error) {
        showMessage('Could not save the schedule in this browser.', 'error');
    }
}

function parseTimeRange(value) {
    const match = String(value || '').match(/^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/);
    if (!match) return 0;

    const startHour = Number(match[1]);
    const startMinute = Number(match[2]);
    const endHour = Number(match[3]);
    const endMinute = Number(match[4]);
    if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return 0;

    const start = startHour * 60 + startMinute;
    let end = endHour * 60 + endMinute;
    if (end < start) end += 24 * 60;
    return (end - start) / 60;
}

function calculateTotals() {
    const dailyTotals = Array(DAYS.length).fill(0);
    let grandTotal = 0;

    document.querySelectorAll('#scheduleBody tr').forEach(row => {
        let weeklyTotal = 0;
        row.querySelectorAll('.shift-input').forEach((input, dayIndex) => {
            const hours = parseTimeRange(input.value);
            dailyTotals[dayIndex] += hours;
            weeklyTotal += hours;
        });
        row.querySelector('.weekly-total').textContent = formatHours(weeklyTotal);
        grandTotal += weeklyTotal;
    });

    DAYS.forEach((day, index) => {
        document.getElementById(day.totalId).textContent = formatHours(dailyTotals[index]);
    });
    document.getElementById('grand-total').textContent = formatHours(grandTotal);
}

function formatHours(hours) {
    return hours.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function initializeDateRange() {
    const dateRange = readSavedDateRange();
    document.getElementById('startDate').value = dateRange.startDate;
    document.getElementById('endDate').value = dateRange.endDate;
    document.getElementById('startDate').addEventListener('input', () => {
        scheduleEditedSinceLoad = true;
        saveDateRange();
    });
    document.getElementById('endDate').addEventListener('input', () => {
        scheduleEditedSinceLoad = true;
        saveDateRange();
    });
    updatePrintDateRange(dateRange);
}

function readSavedDateRange() {
    try {
        const saved = JSON.parse(localStorage.getItem(DATE_RANGE_STORAGE_KEY) || '{}');
        return {
            startDate: typeof saved.startDate === 'string' ? saved.startDate : '',
            endDate: typeof saved.endDate === 'string' ? saved.endDate : ''
        };
    } catch (error) {
        return { startDate: '', endDate: '' };
    }
}

function collectDateRange() {
    return {
        startDate: document.getElementById('startDate').value,
        endDate: document.getElementById('endDate').value
    };
}

function saveDateRange() {
    const dateRange = collectDateRange();
    updatePrintDateRange(dateRange);
    try {
        localStorage.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify(dateRange));
        localStorage.setItem(LOCAL_LAST_EDITED_KEY, new Date().toISOString());
    } catch (error) {
        showMessage('Could not save the date range in this browser.', 'error');
    }
}

function formatDateForDisplay(value) {
    if (!value) return 'Not set';
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
}

function formatDateRange(dateRange) {
    return `Starting Date: ${formatDateForDisplay(dateRange.startDate)}    Ending Date: ${formatDateForDisplay(dateRange.endDate)}`;
}

function updatePrintDateRange(dateRange = collectDateRange()) {
    document.getElementById('printDateRange').textContent = formatDateRange(dateRange);
}

function getSupabaseClient() {
    if (!window.supabase?.createClient) {
        throw new Error('Supabase client did not load.');
    }
    if (!supabaseClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    }
    return supabaseClient;
}

function setScheduleAccess(canEdit) {
    canEditSchedule = canEdit;
    document.querySelectorAll('#scheduleBody input').forEach(input => {
        input.readOnly = !canEdit;
    });
    document.getElementById('startDate').disabled = !canEdit;
    document.getElementById('endDate').disabled = !canEdit;
    document.getElementById('saveButton').hidden = !canEdit;
    document.getElementById('clearButton').hidden = !canEdit;
    document.getElementById('localNote').textContent = canEdit
        ? 'Changes are saved in this browser. Use Save to publish them for everyone.'
        : 'Public schedule · view only. No login is required to view it.';
}

async function saveToSupabase() {
    const button = document.getElementById('saveButton');
    if (!canEditSchedule) {
        showMessage('Only the schedule owner can publish changes.', 'error');
        return;
    }
    const originalLabel = button.textContent;
    const dateRange = collectDateRange();
    if (dateRange.startDate && dateRange.endDate && dateRange.endDate < dateRange.startDate) {
        showMessage('Ending Date must be on or after Starting Date.', 'error');
        return;
    }

    button.disabled = true;
    button.textContent = 'Saving…';
    button.setAttribute('aria-busy', 'true');
    try {
        const client = getSupabaseClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;

        const session = sessionData.session;
        if (session?.user?.id !== PUBLIC_SCHEDULE_OWNER_ID) {
            setScheduleAccess(false);
            showMessage('Only the schedule owner can publish changes.', 'error');
            return;
        }

        const updatedAt = new Date().toISOString();
        const { error: saveError } = await client
            .from(SUPABASE_TABLE)
            .upsert({
                user_id: session.user.id,
                schedule: collectSchedule(),
                start_date: dateRange.startDate || null,
                end_date: dateRange.endDate || null,
                updated_at: updatedAt
            }, { onConflict: 'user_id' });
        if (saveError) throw saveError;

        localStorage.setItem(LOCAL_LAST_EDITED_KEY, updatedAt);
        scheduleEditedSinceLoad = false;
        showMessage('Schedule saved to Supabase.', 'success');
    } catch (error) {
        const message = String(error?.message || '');
        if (/anonymous.*disabled|anonymous provider.*disabled/i.test(message)) {
            showMessage('Enable anonymous sign-ins in Supabase Authentication settings to save online.', 'error');
        } else if (/row-level security|permission denied/i.test(message)) {
            showMessage('Supabase blocked this save. Check the weekly_schedules access policies.', 'error');
        } else if (/failed to fetch|network/i.test(message)) {
            showMessage('Supabase could not be reached. Check your internet connection and try again.', 'error');
        } else {
            showMessage('Could not save the schedule to Supabase. Please try again.', 'error');
        }
    } finally {
        button.disabled = false;
        button.textContent = originalLabel;
        button.removeAttribute('aria-busy');
    }
}

async function restoreSupabaseSchedule() {
    if (!window.supabase?.createClient) {
        showMessage('The public schedule could not be loaded. Please reload the page.', 'error');
        return;
    }
    try {
        const client = getSupabaseClient();
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        const session = sessionData.session;
        const isOwner = session?.user?.id === PUBLIC_SCHEDULE_OWNER_ID;

        const { data, error } = await client
            .from(SUPABASE_TABLE)
            .select('user_id, schedule, start_date, end_date, updated_at')
            .eq('user_id', PUBLIC_SCHEDULE_OWNER_ID)
            .maybeSingle();
        if (error) throw error;
        if (!data || !Array.isArray(data.schedule)) {
            showMessage('The public schedule is not available yet.', 'error');
            return;
        }

        const localLastEdited = Date.parse(localStorage.getItem(LOCAL_LAST_EDITED_KEY) || '') || 0;
        const cloudLastEdited = Date.parse(data.updated_at || '') || 0;
        const hasLocalSchedule = Boolean(localStorage.getItem(STORAGE_KEY));
        setScheduleAccess(isOwner);
        if (isOwner && hasLocalSchedule && (scheduleEditedSinceLoad || localLastEdited > cloudLastEdited)) {
            showMessage('Your newer local changes are ready to publish.', 'success');
            return;
        }

        const remoteSchedule = Array.from({ length: 7 }, (_, index) => {
            const row = data.schedule[index] || {};
            return {
                name: typeof row.name === 'string' ? row.name : '',
                shifts: DAYS.map((_, dayIndex) =>
                    Array.isArray(row.shifts) && typeof row.shifts[dayIndex] === 'string'
                        ? row.shifts[dayIndex]
                        : ''
                )
            };
        });
        const dateRange = {
            startDate: data.start_date || '',
            endDate: data.end_date || ''
        };
        renderRows(remoteSchedule);
        calculateTotals();
        document.getElementById('startDate').value = dateRange.startDate;
        document.getElementById('endDate').value = dateRange.endDate;
        updatePrintDateRange(dateRange);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(remoteSchedule));
        localStorage.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify(dateRange));
        localStorage.setItem(LOCAL_LAST_EDITED_KEY, data.updated_at || new Date().toISOString());
        showMessage(isOwner ? 'Your public schedule loaded.' : 'Public schedule loaded.', 'success');
    } catch (error) {
        setScheduleAccess(false);
        showMessage('Could not load the saved schedule from Supabase.', 'error');
    }
}

function generateExcel() {
    if (!window.XLSX) {
        showMessage('Excel export is unavailable. Reload the page and try again.', 'error');
        return;
    }

    calculateTotals();
    const employees = collectSchedule();
    const dailyTotals = Array(DAYS.length).fill(0);
    const data = [['Employee', ...DAYS.map(day => day.label), 'Total Hours']];

    employees.forEach((employee, index) => {
        let weeklyTotal = 0;
        const shifts = employee.shifts.map((shift, dayIndex) => {
            const hours = parseTimeRange(shift);
            dailyTotals[dayIndex] += hours;
            weeklyTotal += hours;
            return shift;
        });
        const name = employee.name || (employee.shifts.some(Boolean) ? `Employee ${index + 1}` : '');
        data.push([name, ...shifts, Number(weeklyTotal.toFixed(2))]);
    });

    const grandTotal = dailyTotals.reduce((sum, hours) => sum + hours, 0);
    data.push(['Daily Total', ...dailyTotals.map(hours => Number(hours.toFixed(2))), Number(grandTotal.toFixed(2))]);

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [{ wch: 24 }, ...DAYS.map(() => ({ wch: 18 })), { wch: 14 }];
    worksheet['!autofilter'] = { ref: `A1:I${employees.length + 1}` };
    worksheet['!ref'] = `A1:I${data.length}`;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Weekly Schedule');
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(workbook, `Weekly_Schedule_${date}.xlsx`);
    showMessage('Excel file downloaded.', 'success');
}

function generatePdfDownload() {
    calculateTotals();
    const pdf = buildSchedulePdf(collectSchedule(), collectDateRange());
    const blob = new Blob([pdf], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    link.href = url;
    link.download = `Weekly_Schedule_${date}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showMessage('PDF file downloaded.', 'success');
}

function buildSchedulePdf(employees, dateRange) {
    const pageWidth = 841.89;
    const pageHeight = 595.28;
    const margin = 24;
    const tableX = margin;
    const tableWidth = pageWidth - margin * 2;
    const employeeWidth = 143;
    const totalWidth = 81;
    const dayWidth = (tableWidth - employeeWidth - totalWidth) / DAYS.length;
    const columnWidths = [employeeWidth, ...DAYS.map(() => dayWidth), totalWidth];
    const headerHeight = 28;
    const rowHeight = 30;
    const tableTop = pageHeight - 105;
    const commands = [];
    const dailyTotals = Array(DAYS.length).fill(0);
    let grandTotal = 0;

    const rgb = hex => {
        const value = hex.replace('#', '');
        return [0, 2, 4].map(offset => (parseInt(value.slice(offset, offset + 2), 16) / 255).toFixed(3)).join(' ');
    };
    const pdfNumber = value => Number(value.toFixed(2)).toString();
    const drawRect = (x, y, width, height, color) => {
        commands.push(`${rgb(color)} rg ${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(width)} ${pdfNumber(height)} re f`);
    };
    const drawLine = (x1, y1, x2, y2) => {
        commands.push(`0.682 0.733 0.698 RG 0.6 w ${pdfNumber(x1)} ${pdfNumber(y1)} m ${pdfNumber(x2)} ${pdfNumber(y2)} l S`);
    };
    const escapeText = value => {
        const cp1252 = new Map([
            [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
            [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
            [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
            [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
            [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
            [0x017e, 0x9e], [0x0178, 0x9f]
        ]);
        const encoded = Array.from(String(value).normalize('NFC'), character => {
            const code = character.codePointAt(0);
            const byte = code >= 32 && code <= 126 ? code
                : code >= 160 && code <= 255 ? code
                    : cp1252.get(code) ?? 63;
            if (byte === 40 || byte === 41 || byte === 92) return `\\${String.fromCharCode(byte)}`;
            if (byte < 32 || byte > 126) return `\\${byte.toString(8).padStart(3, '0')}`;
            return String.fromCharCode(byte);
        }).join('');
        return `(${encoded})`;
    };
    const estimateTextWidth = (value, size) => Array.from(String(value)).reduce((width, character) => {
        if (' ilI.,:'.includes(character)) return width + size * 0.28;
        if ('MW@'.includes(character)) return width + size * 0.78;
        return width + size * 0.52;
    }, 0);
    const drawText = (value, x, y, size, options = {}) => {
        const text = String(value);
        const font = options.bold ? 'F2' : 'F1';
        const color = options.color || '#18332e';
        const width = estimateTextWidth(text, size);
        const textX = options.align === 'center' ? x - width / 2 : x;
        commands.push(`${rgb(color)} rg BT /${font} ${pdfNumber(size)} Tf 1 0 0 1 ${pdfNumber(textX)} ${pdfNumber(y)} Tm ${escapeText(text)} Tj ET`);
    };

    drawText('Weekly Schedule', margin, pageHeight - 45, 22, { bold: true, color: '#163b33' });
    drawText(formatDateRange(dateRange), margin, pageHeight - 68, 10, { color: '#62726d' });

    const headers = ['Employee', ...DAYS.map(day => day.label), 'Total Hours'];
    let x = tableX;
    headers.forEach((header, index) => {
        drawRect(x, tableTop - headerHeight, columnWidths[index], headerHeight, '#163b33');
        drawText(header, x + columnWidths[index] / 2, tableTop - headerHeight / 2 - 3, 8, { bold: true, color: '#ffffff', align: 'center' });
        x += columnWidths[index];
    });

    employees.forEach((employee, rowIndex) => {
        let weeklyTotal = 0;
        employee.shifts.forEach((shift, dayIndex) => {
            const hours = parseTimeRange(shift);
            dailyTotals[dayIndex] += hours;
            weeklyTotal += hours;
        });
        grandTotal += weeklyTotal;

        const rowTop = tableTop - headerHeight - rowIndex * rowHeight;
        const rowBottom = rowTop - rowHeight;
        x = tableX;
        const values = [employee.name, ...employee.shifts, formatHours(weeklyTotal)];
        values.forEach((value, columnIndex) => {
            const width = columnWidths[columnIndex];
            const fill = columnIndex === columnWidths.length - 1
                ? '#e7f3eb'
                : rowIndex % 2 === 1 ? '#f8faf8' : '#ffffff';
            drawRect(x, rowBottom, width, rowHeight, fill);
            const fontSize = columnIndex === 0 && value
                ? Math.max(6, Math.min(9, (width - 12) / (String(value).length * 0.52)))
                : 9;
            const textX = columnIndex === 0 ? x + 6 : x + width / 2;
            drawText(value, textX, rowBottom + rowHeight / 2 - fontSize / 3, fontSize, {
                bold: columnIndex === columnWidths.length - 1,
                align: columnIndex === 0 ? 'left' : 'center'
            });
            x += width;
        });
    });

    const footerTop = tableTop - headerHeight - employees.length * rowHeight;
    const footerBottom = footerTop - rowHeight;
    x = tableX;
    const footerValues = ['Daily Total', ...dailyTotals.map(formatHours), formatHours(grandTotal)];
    footerValues.forEach((value, columnIndex) => {
        const width = columnWidths[columnIndex];
        drawRect(x, footerBottom, width, rowHeight, columnIndex === columnWidths.length - 1 ? '#d8e9b1' : '#edf4d4');
        drawText(value, columnIndex === 0 ? x + 6 : x + width / 2, footerBottom + rowHeight / 2 - 3, 9, {
            bold: true,
            align: columnIndex === 0 ? 'left' : 'center'
        });
        x += width;
    });

    const tableBottom = footerBottom;
    drawLine(tableX, tableTop, tableX + tableWidth, tableTop);
    drawLine(tableX, tableBottom, tableX + tableWidth, tableBottom);
    let verticalX = tableX;
    drawLine(verticalX, tableBottom, verticalX, tableTop);
    columnWidths.forEach(width => {
        verticalX += width;
        drawLine(verticalX, tableBottom, verticalX, tableTop);
    });
    for (let row = 0; row <= employees.length + 1; row += 1) {
        const y = tableTop - headerHeight - row * rowHeight;
        drawLine(tableX, y, tableX + tableWidth, y);
    }

    const content = commands.join('\n');
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(pdf.length);
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return pdf;
}

function clearAll() {
    if (!window.confirm('Clear all employee names and shifts?')) return;
    document.querySelectorAll('.employee-input, .shift-input').forEach(input => { input.value = ''; });
    calculateTotals();
    saveSchedule();
    showMessage('Schedule cleared.', 'success');
}

function showMessage(text, type) {
    const message = document.getElementById('message');
    message.textContent = text;
    message.className = `message ${type}`;
}

function clearMessage() {
    const message = document.getElementById('message');
    message.textContent = '';
    message.className = 'message';
}
