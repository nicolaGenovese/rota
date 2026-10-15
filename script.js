const STORAGE_KEY = 'turniSettimanali';
const DATE_RANGE_STORAGE_KEY = 'turniSettimanaliDateRange';
const WEEKS_STORAGE_KEY = 'turniSettimanaliWeeks';
const LOCAL_LAST_EDITED_KEY = 'turniSettimanaliLastEdited';
const SUPABASE_URL = 'https://sudysoizwfddpladkzeo.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kcmzYpi72KPwt1aI_SOyVQ_-J2FpTqR';
const SUPABASE_TABLE = 'weekly_schedules';
const PUBLIC_SCHEDULE_ROW_ID = '1c3d3e6c-6dbe-4418-b8d6-3e3251b407a9';
let supabaseClient = null;
let scheduleEditedSinceLoad = false;
let scheduleByWeek = {};
let dirtyWeekKeys = new Set();
let selectedWeekOffset = 0;
const currentWeekStart = getMonday(new Date());
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
    scheduleByWeek = readSavedSchedules();
    const initialSchedule = scheduleByWeek[getWeekKey(0)]
        || (Object.keys(scheduleByWeek).length ? makeBlankWeekSchedule() : DEFAULT_EMPLOYEES);
    renderRows(initialSchedule);
    updateWeekNavigation();

    document.getElementById('scheduleBody').addEventListener('input', () => {
        scheduleEditedSinceLoad = true;
        dirtyWeekKeys.add(getWeekKey(selectedWeekOffset));
        calculateTotals();
        saveSchedule();
    });
    document.getElementById('previousWeekButton').addEventListener('click', () => changeSelectedWeek(-1));
    document.getElementById('nextWeekButton').addEventListener('click', () => changeSelectedWeek(1));
    document.getElementById('saveButton').addEventListener('click', saveToSupabase);
    document.getElementById('pdfDownloadButton').addEventListener('click', generatePdfDownload);
    document.getElementById('excelButton').addEventListener('click', generateExcel);
    document.getElementById('pdfPrintButton').addEventListener('click', () => window.print());
    document.getElementById('clearButton').addEventListener('click', clearAll);
    calculateTotals();
    const saveButton = document.getElementById('saveButton');
    saveButton.disabled = true;
    saveButton.textContent = 'Loading…';
    saveButton.setAttribute('aria-busy', 'true');
    restoreSupabaseSchedule();
}

function getMonday(date) {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
}

function getWeekDates(offset = selectedWeekOffset) {
    const monday = new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth(), currentWeekStart.getDate());
    monday.setDate(monday.getDate() + offset * 7);
    return DAYS.map((_, dayIndex) => {
        const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
        date.setDate(date.getDate() + dayIndex);
        return date;
    });
}

function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getWeekKey(offset = selectedWeekOffset) {
    return dateKey(getWeekDates(offset)[0]);
}

function getWeekOffsetForDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 0;
    const [year, month, day] = value.split('-').map(Number);
    const monday = getMonday(new Date(year, month - 1, day));
    return Math.round((monday - currentWeekStart) / (7 * 24 * 60 * 60 * 1000));
}

function normalizeEmployeeSchedule(rows) {
    if (!Array.isArray(rows)) return null;
    return Array.from({ length: 7 }, (_, index) => {
        const row = rows[index] || {};
        return {
            name: typeof row.name === 'string' ? row.name : '',
            shifts: DAYS.map((_, dayIndex) =>
                Array.isArray(row.shifts) && typeof row.shifts[dayIndex] === 'string' ? row.shifts[dayIndex] : ''
            )
        };
    });
}

function normalizeSchedulePayload(payload, legacyDate = '') {
    if (Array.isArray(payload)) {
        const rows = normalizeEmployeeSchedule(payload);
        return rows ? { [getLegacyWeekKey(legacyDate)]: rows } : {};
    }
    const weeks = payload && !Array.isArray(payload) && typeof payload === 'object'
        ? (payload.weeks && typeof payload.weeks === 'object' ? payload.weeks : payload)
        : {};
    return Object.fromEntries(Object.entries(weeks)
        .filter(([key, rows]) => /^\d{4}-\d{2}-\d{2}$/.test(key)
            && Array.isArray(rows)
            && getWeekOffsetForDate(key) >= 0
            && getWeekOffsetForDate(key) <= 3)
        .map(([key, rows]) => [key, normalizeEmployeeSchedule(rows)]));
}

function getLegacyWeekKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return getWeekKey(0);
    const [year, month, day] = value.split('-').map(Number);
    const mondayKey = dateKey(getMonday(new Date(year, month - 1, day)));
    const offset = getWeekOffsetForDate(mondayKey);
    return offset >= 0 && offset <= 3 ? mondayKey : getWeekKey(0);
}

function readSavedSchedules() {
    try {
        const savedWeeks = localStorage.getItem(WEEKS_STORAGE_KEY);
        if (savedWeeks) {
            const parsed = JSON.parse(savedWeeks);
            const normalized = normalizeSchedulePayload(parsed);
            if (Object.keys(normalized).length) return normalized;
        }

        const legacyRows = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        const oldDateRange = JSON.parse(localStorage.getItem(DATE_RANGE_STORAGE_KEY) || '{}');
        return normalizeSchedulePayload(legacyRows, oldDateRange.startDate || '');
    } catch (error) {
        return {};
    }
}

function makeBlankWeekSchedule() {
    const knownWeek = Object.values(scheduleByWeek).find(Array.isArray);
    const employeeNames = (knownWeek || DEFAULT_EMPLOYEES).map(employee => employee?.name || '');
    return Array.from({ length: 7 }, (_, index) => ({ name: employeeNames[index] || '', shifts: Array(7).fill('') }));
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
        const weekKey = getWeekKey(selectedWeekOffset);
        scheduleByWeek[weekKey] = collectSchedule();
        localStorage.setItem(WEEKS_STORAGE_KEY, JSON.stringify({ version: 2, weeks: scheduleByWeek }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scheduleByWeek[weekKey]));
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

function formatDateWithWeekday(date) {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatWeekLabel(dates = getWeekDates()) {
    return `${formatDateWithWeekday(dates[0])} – ${formatDateWithWeekday(dates[6])}`;
}

function updateWeekNavigation() {
    const dates = getWeekDates();
    document.getElementById('weekPosition').textContent = `Week ${selectedWeekOffset + 1} of 4`;
    document.getElementById('weekLabel').textContent = formatWeekLabel(dates);
    document.getElementById('printDateRange').textContent = formatWeekLabel(dates);
    document.getElementById('previousWeekButton').disabled = selectedWeekOffset === 0;
    document.getElementById('nextWeekButton').disabled = selectedWeekOffset === 3;
    DAYS.forEach((day, index) => {
        const header = document.getElementById(`day-header-${index}`);
        header.querySelector('.day-label').textContent = day.label;
        header.querySelector('.day-date').textContent = String(dates[index].getDate());
        header.setAttribute('aria-label', formatDateWithWeekday(dates[index]));
    });
}

function changeSelectedWeek(change) {
    const nextOffset = selectedWeekOffset + change;
    if (nextOffset < 0 || nextOffset > 3) return;
    const oldWeekKey = getWeekKey(selectedWeekOffset);
    scheduleByWeek[oldWeekKey] = collectSchedule();
    try {
        localStorage.setItem(WEEKS_STORAGE_KEY, JSON.stringify({ version: 2, weeks: scheduleByWeek }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scheduleByWeek[oldWeekKey]));
    } catch (error) {
        showMessage('Could not save the schedule in this browser.', 'error');
    }

    selectedWeekOffset = nextOffset;
    updateWeekNavigation();
    renderRows(scheduleByWeek[getWeekKey()] || makeBlankWeekSchedule());
    calculateTotals();
    clearMessage();
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

async function saveToSupabase() {
    const button = document.getElementById('saveButton');
    const originalLabel = button.textContent;
    const weekKey = getWeekKey();
    const weekDates = getWeekDates();
    scheduleByWeek[weekKey] = collectSchedule();
    dirtyWeekKeys.add(weekKey);
    const localChanges = new Set(dirtyWeekKeys);
    const activeSchedule = scheduleByWeek[weekKey];
    const actionButtons = Array.from(document.querySelectorAll('.button-group button'));
    const scheduleInputs = Array.from(document.querySelectorAll('#scheduleBody input'));
    button.disabled = true;
    button.textContent = 'Saving…';
    button.setAttribute('aria-busy', 'true');
    actionButtons.forEach(actionButton => { actionButton.disabled = true; });
    scheduleInputs.forEach(input => { input.disabled = true; });
    document.getElementById('previousWeekButton').disabled = true;
    document.getElementById('nextWeekButton').disabled = true;
    try {
        const client = getSupabaseClient();
        const { data: existing, error: loadError } = await client
            .from(SUPABASE_TABLE)
            .select('schedule, start_date')
            .eq('user_id', PUBLIC_SCHEDULE_ROW_ID)
            .maybeSingle();
        if (loadError) throw loadError;

        const mergedWeeks = normalizeSchedulePayload(existing?.schedule, existing?.start_date || weekKey);
        localChanges.forEach(changedWeekKey => {
            if (scheduleByWeek[changedWeekKey]) mergedWeeks[changedWeekKey] = scheduleByWeek[changedWeekKey];
        });
        mergedWeeks[weekKey] = activeSchedule;
        const updatedAt = new Date().toISOString();
        const { error: saveError } = await client
            .from(SUPABASE_TABLE)
            .upsert({
                user_id: PUBLIC_SCHEDULE_ROW_ID,
                schedule: { version: 2, weeks: mergedWeeks },
                start_date: dateKey(weekDates[0]),
                end_date: dateKey(weekDates[6]),
                updated_at: updatedAt
            }, { onConflict: 'user_id' });
        if (saveError) throw saveError;

        scheduleByWeek = mergedWeeks;
        dirtyWeekKeys.clear();
        localStorage.setItem(WEEKS_STORAGE_KEY, JSON.stringify({ version: 2, weeks: scheduleByWeek }));
        localStorage.setItem(LOCAL_LAST_EDITED_KEY, updatedAt);
        scheduleEditedSinceLoad = false;
        const savedWeeksCount = localChanges.size;
        showMessage(`Shared schedule saved for ${savedWeeksCount} ${savedWeeksCount === 1 ? 'week' : 'weeks'}.`, 'success');
    } catch (error) {
        const message = String(error?.message || '');
        if (/row-level security|permission denied/i.test(message)) {
            showMessage('Supabase blocked this save. Check the public weekly_schedules write policies.', 'error');
        } else if (/failed to fetch|network/i.test(message)) {
            showMessage('Supabase could not be reached. Check your internet connection and try again.', 'error');
        } else {
            showMessage('Could not save the schedule to Supabase. Please try again.', 'error');
        }
    } finally {
        actionButtons.forEach(actionButton => { actionButton.disabled = false; });
        scheduleInputs.forEach(input => { input.disabled = false; });
        button.textContent = originalLabel;
        button.removeAttribute('aria-busy');
        updateWeekNavigation();
    }
}

async function restoreSupabaseSchedule() {
    if (!window.supabase?.createClient) {
        showMessage('The public schedule could not be loaded. Please reload the page.', 'error');
        finishInitialSupabaseLoad();
        return;
    }
    try {
        const client = getSupabaseClient();
        const { data, error } = await client
            .from(SUPABASE_TABLE)
            .select('user_id, schedule, start_date, end_date, updated_at')
            .eq('user_id', PUBLIC_SCHEDULE_ROW_ID)
            .maybeSingle();
        if (error) throw error;
        if (!data || !data.schedule) {
            showMessage('No shared schedule has been saved yet. Enter shifts and press Save to share them.', 'success');
            return;
        }

        const remoteWeeks = normalizeSchedulePayload(data.schedule, data.start_date || getWeekKey(0));
        dirtyWeekKeys.forEach(key => {
            if (scheduleByWeek[key]) remoteWeeks[key] = scheduleByWeek[key];
        });
        scheduleByWeek = remoteWeeks;
        const activeWeekKey = getWeekKey(selectedWeekOffset);
        renderRows(scheduleByWeek[activeWeekKey] || makeBlankWeekSchedule());
        calculateTotals();
        updateWeekNavigation();
        localStorage.setItem(WEEKS_STORAGE_KEY, JSON.stringify({ version: 2, weeks: scheduleByWeek }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scheduleByWeek[activeWeekKey] || []));
        localStorage.setItem(LOCAL_LAST_EDITED_KEY, data.updated_at || new Date().toISOString());
        if (scheduleEditedSinceLoad) {
            showMessage('Local edits are preserved. Press Save to share them.', 'success');
        } else {
            showMessage('Shared schedules loaded. Anyone with the link can edit them.', 'success');
        }
    } catch (error) {
        showMessage('Could not load the saved schedule from Supabase.', 'error');
    } finally {
        finishInitialSupabaseLoad();
    }
}

function finishInitialSupabaseLoad() {
    const button = document.getElementById('saveButton');
    button.disabled = false;
    button.textContent = 'Save';
    button.removeAttribute('aria-busy');
}

function generateExcel() {
    if (!window.XLSX) {
        showMessage('Excel export is unavailable. Reload the page and try again.', 'error');
        return;
    }

    calculateTotals();
    const employees = collectSchedule();
    const dailyTotals = Array(DAYS.length).fill(0);
    const data = [['Employee', ...DAYS.map((day, index) => `${day.label} ${getWeekDates()[index].getDate()}`), 'Total Hours']];

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
    const pdf = buildSchedulePdf(collectSchedule(), formatWeekLabel());
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

function buildSchedulePdf(employees, weekLabel) {
    const pageWidth = 841.89;
    const pageHeight = 595.28;
    const margin = 24;
    const tableX = margin;
    const tableWidth = pageWidth - margin * 2;
    const employeeWidth = 143;
    const dayWidth = (tableWidth - employeeWidth) / DAYS.length;
    const columnWidths = [employeeWidth, ...DAYS.map(() => dayWidth)];
    const headerHeight = 28;
    const rowHeight = 30;
    const tableTop = pageHeight - 105;
    const commands = [];
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
    drawText(weekLabel, margin, pageHeight - 68, 10, { color: '#62726d' });

    const dates = getWeekDates();
    const headers = ['Employee', ...DAYS.map((day, index) => `${day.label} ${dates[index].getDate()}`)];
    let x = tableX;
    headers.forEach((header, index) => {
        drawRect(x, tableTop - headerHeight, columnWidths[index], headerHeight, '#163b33');
        drawText(header, x + columnWidths[index] / 2, tableTop - headerHeight / 2 - 3, 8, { bold: true, color: '#ffffff', align: 'center' });
        x += columnWidths[index];
    });

    employees.forEach((employee, rowIndex) => {
        const rowTop = tableTop - headerHeight - rowIndex * rowHeight;
        const rowBottom = rowTop - rowHeight;
        x = tableX;
        const values = [employee.name, ...employee.shifts];
        values.forEach((value, columnIndex) => {
            const width = columnWidths[columnIndex];
            const fill = rowIndex % 2 === 1 ? '#f8faf8' : '#ffffff';
            drawRect(x, rowBottom, width, rowHeight, fill);
            const fontSize = columnIndex === 0 && value
                ? Math.max(6, Math.min(9, (width - 12) / (String(value).length * 0.52)))
                : 9;
            const textX = columnIndex === 0 ? x + 6 : x + width / 2;
            drawText(value, textX, rowBottom + rowHeight / 2 - fontSize / 3, fontSize, {
                align: columnIndex === 0 ? 'left' : 'center'
            });
            x += width;
        });
    });

    const tableBottom = tableTop - headerHeight - employees.length * rowHeight;
    drawLine(tableX, tableTop, tableX + tableWidth, tableTop);
    drawLine(tableX, tableBottom, tableX + tableWidth, tableBottom);
    let verticalX = tableX;
    drawLine(verticalX, tableBottom, verticalX, tableTop);
    columnWidths.forEach(width => {
        verticalX += width;
        drawLine(verticalX, tableBottom, verticalX, tableTop);
    });
    for (let row = 0; row <= employees.length; row += 1) {
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
    if (!window.confirm('Clear employee names and shifts for this week?')) return;
    document.querySelectorAll('.employee-input, .shift-input').forEach(input => { input.value = ''; });
    scheduleEditedSinceLoad = true;
    dirtyWeekKeys.add(getWeekKey());
    calculateTotals();
    saveSchedule();
    showMessage('This week’s schedule cleared. Press Save to share the change.', 'success');
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
