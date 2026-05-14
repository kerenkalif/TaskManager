/* ============================================================
   המשימות שלי — Application Logic
   ============================================================ */

// ===== Constants =====
const APP_VERSION = '1.3.2';
const STORAGE_KEY = 'taskmanager_v1';
const ALERTED_KEY = 'taskmanager_alerted_v1';
const SAFETY_BACKUP_KEY = 'taskmanager_safety_backup';
const DEFAULT_TIME = '09:00';
const OVERDUE_LOOKBACK_DAYS = 14;
const FUTURE_LOOKAHEAD_DAYS = 90;
const DEFAULT_RECURRENCE_COUNT = 10;
const MAX_RECURRENCE_COUNT = 365;
const REMINDER_SCHEDULE_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

const CATEGORY_COLORS = [
    '#009999', // brand teal
    '#FFD54F', // brand yellow
    '#A8D8D3', // soft teal
    '#E74C3C', // red
    '#9B59B6', // purple
    '#3498DB', // blue
    '#27AE60', // green
    '#E67E22'  // orange
];

const DEFAULT_CATEGORIES = [
    { id: 'cat_personal', name: 'אישי', color: '#009999' },
    { id: 'cat_work', name: 'עבודה', color: '#3498DB' },
    { id: 'cat_home', name: 'בית', color: '#27AE60' }
];

const WEEKDAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const WEEKDAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// ===== State =====
let state = {
    categories: [],
    tasks: [],
    completions: {}, // { 'taskId_YYYY-MM-DD': { doneAt: ISOstring } }
    settings: { remindersEnabled: true },
    ui: {
        view: 'main',
        categoryFilter: [], // empty array = no filter (shows all)
        statusFilter: 'all', // 'all' | 'pending' | 'done' (for all-tasks view)
        futureExpanded: false,
        overdueExpanded: true
    }
};

// ===== Date helpers =====
function todayStr() {
    const d = new Date();
    return formatDate(d);
}
function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function addDays(s, n) {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return formatDate(d);
}
function dayOfWeek(s) {
    return parseDate(s).getDay();
}
function prettyDate(s) {
    const today = todayStr();
    const tomorrow = addDays(today, 1);
    const yesterday = addDays(today, -1);
    if (s === today) return 'היום';
    if (s === tomorrow) return 'מחר';
    if (s === yesterday) return 'אתמול';
    const d = parseDate(s);
    return `${WEEKDAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

// ===== Storage =====
function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            state.categories = [...DEFAULT_CATEGORIES];
            saveState();
            return;
        }
        const data = JSON.parse(raw);
        state.categories = data.categories || [...DEFAULT_CATEGORIES];
        state.tasks = data.tasks || [];
        state.completions = data.completions || {};
        state.settings = Object.assign({ remindersEnabled: true }, data.settings || {});
    } catch (e) {
        console.error('Failed to load state', e);
        state.categories = [...DEFAULT_CATEGORIES];
        state.tasks = [];
        state.completions = {};
    }
}

function saveState() {
    const data = {
        categories: state.categories,
        tasks: state.tasks,
        completions: state.completions,
        settings: state.settings
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    scheduleReminders();
}

// ===== ID helper =====
function newId(prefix) {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

// ===== Recurring task expansion =====
// Pure rule match — does the recurrence pattern hit this date? (Ignores count + exceptions.)
function recurrenceHits(task, dateStr) {
    if (!task.recurrence) return dateStr === task.dueDate;
    if (dateStr < task.dueDate) return false;
    const r = task.recurrence;
    if (r.type === 'daily') return true;
    if (r.type === 'weekly') {
        const dow = dayOfWeek(dateStr);
        const days = (r.weekdays && r.weekdays.length > 0)
            ? r.weekdays
            : [dayOfWeek(task.dueDate)];
        return days.includes(dow);
    }
    if (r.type === 'monthly') {
        return parseDate(task.dueDate).getDate() === parseDate(dateStr).getDate();
    }
    return false;
}

// All actual occurrence dates for a task. Honors endType: 'count' | 'until' | 'forever'.
// latestDate caps the iteration (used for view-range queries; 'forever' depends on it).
function getTaskOccurrenceDates(task, latestDate) {
    if (!task.recurrence) return [task.dueDate];
    const r = task.recurrence;
    const endType = r.endType || 'count';
    const exceptions = new Set(task.exceptions || []);
    const cap = latestDate || addDays(todayStr(), 365);
    const out = [];
    let date = task.dueDate;
    let matched = 0;
    let safety = 0;
    while (safety < 10000 && date <= cap) {
        if (recurrenceHits(task, date)) {
            if (endType === 'count' && matched >= (r.count || DEFAULT_RECURRENCE_COUNT)) break;
            if (endType === 'until' && r.until && date > r.until) break;
            matched++;
            if (!exceptions.has(date)) out.push(date);
        }
        date = addDays(date, 1);
        safety++;
    }
    return out;
}

// Returns the "occurrence" virtual object for a task on a given date
function occurrenceFor(task, dateStr) {
    const key = `${task.id}__${dateStr}`;
    if (task.recurrence) {
        const done = !!state.completions[key];
        return {
            id: key,
            taskId: task.id,
            text: task.text,
            categoryId: task.categoryId,
            dueDate: dateStr,
            dueTime: task.dueTime,
            done: done,
            doneAt: done ? state.completions[key].doneAt : null,
            recurring: true
        };
    } else {
        return {
            id: task.id,
            taskId: task.id,
            text: task.text,
            categoryId: task.categoryId,
            dueDate: task.dueDate,
            dueTime: task.dueTime,
            done: !!task.done,
            doneAt: task.doneAt || null,
            recurring: false
        };
    }
}

// Get all occurrences in a date range (inclusive)
function getOccurrencesInRange(fromDate, toDate) {
    const out = [];
    for (const task of state.tasks) {
        const dates = getTaskOccurrenceDates(task, toDate);
        for (const d of dates) {
            if (d >= fromDate && d <= toDate) {
                out.push(occurrenceFor(task, d));
            }
        }
    }
    return out;
}

// Get occurrences for a single date
function getOccurrencesOn(dateStr) {
    return getOccurrencesInRange(dateStr, dateStr);
}

// Get overdue occurrences (before today, not done)
function getOverdueOccurrences() {
    const today = todayStr();
    const lookback = addDays(today, -OVERDUE_LOOKBACK_DAYS);
    const yesterday = addDays(today, -1);
    return getOccurrencesInRange(lookback, yesterday).filter(o => !o.done);
}

// Get future occurrences (after today)
function getFutureOccurrences() {
    const today = todayStr();
    const tomorrow = addDays(today, 1);
    const horizon = addDays(today, FUTURE_LOOKAHEAD_DAYS);
    return getOccurrencesInRange(tomorrow, horizon);
}

// ===== Mark done / undone =====
function setOccurrenceDone(occ, done) {
    if (occ.recurring) {
        const key = `${occ.taskId}__${occ.dueDate}`;
        if (done) {
            state.completions[key] = { doneAt: new Date().toISOString() };
        } else {
            delete state.completions[key];
        }
    } else {
        const task = state.tasks.find(t => t.id === occ.taskId);
        if (task) {
            task.done = done;
            task.doneAt = done ? new Date().toISOString() : null;
        }
    }
    saveState();
}

// ===== Filtering by category =====
function filterByCategory(occurrences) {
    const filters = state.ui.categoryFilter || [];
    if (filters.length === 0) return occurrences;
    return occurrences.filter(o => filters.includes(o.categoryId));
}

function toggleCategoryFilter(catId) {
    if (catId === 'all') {
        state.ui.categoryFilter = [];
        return;
    }
    const filters = state.ui.categoryFilter || [];
    const idx = filters.indexOf(catId);
    if (idx >= 0) filters.splice(idx, 1);
    else filters.push(catId);
    state.ui.categoryFilter = filters;
}

// ===== Sort helpers =====
function sortByTime(a, b) {
    return a.dueTime.localeCompare(b.dueTime);
}
function sortByDateTime(a, b) {
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return a.dueTime.localeCompare(b.dueTime);
}

// ===== Category helpers =====
function getCategory(id) {
    return state.categories.find(c => c.id === id);
}

// ===== Rendering =====
function $(sel, root) { return (root || document).querySelector(sel); }

function render() {
    const app = $('#app');
    let html = '';
    html += renderHeader();
    html += renderFilterChips();
    html += '<div class="main-content">';
    if (state.ui.view === 'main') html += renderMainView();
    else if (state.ui.view === 'all') html += renderAllTasksView();
    else if (state.ui.view === 'categories') html += renderCategoriesView();
    else if (state.ui.view === 'settings') html += renderSettingsView();
    html += '</div>';
    html += renderFab();
    html += renderBottomNav();
    app.innerHTML = html;
    attachEventListeners();
}

function renderHeader() {
    const titles = {
        main: { title: 'המשימות שלי', sub: prettyDate(todayStr()) },
        all: { title: 'כל המשימות', sub: 'הצג ופלטר את כל המשימות' },
        categories: { title: 'קטגוריות', sub: 'נהל את הקטגוריות שלך' },
        settings: { title: 'הגדרות', sub: '' }
    };
    const t = titles[state.ui.view] || titles.main;
    return `
        <header class="app-header">
            <h1>${escapeHtml(t.title)}</h1>
            ${t.sub ? `<div class="subtitle">${escapeHtml(t.sub)}</div>` : ''}
        </header>
    `;
}

function renderFilterChips() {
    if (state.ui.view !== 'main') return '';
    const filters = state.ui.categoryFilter || [];
    const allActive = filters.length === 0;
    let html = '<div class="filter-chips">';
    html += `<button class="chip ${allActive ? 'active' : ''}" data-action="filter" data-cat="all">
        <span class="chip-dot"></span>הכל</button>`;
    for (const cat of state.categories) {
        const active = filters.includes(cat.id);
        html += `<button class="chip ${active ? 'active' : ''}" data-action="filter" data-cat="${cat.id}">
            <span class="chip-dot" style="background:${cat.color}"></span>${escapeHtml(cat.name)}</button>`;
    }
    html += '</div>';
    return html;
}

function renderMainView() {
    const today = todayStr();
    const todayOccs = filterByCategory(getOccurrencesOn(today)).sort(sortByTime);
    const overdueOccs = filterByCategory(getOverdueOccurrences()).sort(sortByDateTime);
    const futureOccs = filterByCategory(getFutureOccurrences()).sort(sortByDateTime);

    let html = '';

    // Today section
    html += `
        <section class="section section-today">
            <div class="section-header">
                <div class="section-title">📌 היום</div>
                <span class="section-count">${todayOccs.length}</span>
            </div>
            <div class="section-body">
                ${todayOccs.length === 0
                    ? emptyState('🎉', 'יום פנוי!', 'אין משימות להיום')
                    : todayOccs.map(o => renderTaskCard(o, true)).join('')}
            </div>
        </section>
    `;

    // Overdue section
    if (overdueOccs.length > 0) {
        html += `
            <section class="section section-overdue">
                <div class="section-header">
                    <div class="section-title">⚠️ לא בוצעו</div>
                    <span class="section-count">${overdueOccs.length}</span>
                </div>
                <div class="section-body">
                    ${overdueOccs.map(o => renderTaskCard(o, false, true)).join('')}
                </div>
            </section>
        `;
    }

    // Future section
    html += `
        <section class="section section-future ${state.ui.futureExpanded ? '' : 'collapsed'}">
            <div class="section-header" data-action="toggle-future">
                <div class="section-title">
                    <span class="toggle-arrow">▼</span>
                    🔮 עתידיות
                </div>
                <span class="section-count">${futureOccs.length}</span>
            </div>
            <div class="section-body">
                ${futureOccs.length === 0
                    ? emptyState('📅', 'אין משימות עתידיות', '')
                    : futureOccs.map(o => renderTaskCard(o, false)).join('')}
            </div>
        </section>
    `;

    return html;
}

function renderTaskCard(occ, isToday, isOverdue) {
    const cat = getCategory(occ.categoryId);
    const taskRef = state.tasks.find(t => t.id === occ.taskId);
    const recurring = taskRef && taskRef.recurrence;
    return `
        <div class="task-card ${occ.done ? 'done' : ''} ${isOverdue ? 'overdue' : ''} ${isToday && !occ.done ? 'today-highlight' : ''}">
            <div class="task-checkbox ${occ.done ? 'checked' : ''}"
                 data-action="toggle-done"
                 data-task-id="${occ.taskId}"
                 data-date="${occ.dueDate}"></div>
            <div class="task-body" data-action="task-edit"
                 data-task-id="${occ.taskId}" data-date="${occ.dueDate}">
                <div class="task-text">${escapeHtml(occ.text)}</div>
                <div class="task-meta">
                    <span class="task-time">🕘 ${occ.dueTime}</span>
                    ${!isToday ? `<span>· ${prettyDate(occ.dueDate)}</span>` : ''}
                    ${cat ? `<span class="task-category-tag" style="background:${cat.color}22;color:${cat.color}">
                        <span class="chip-dot" style="background:${cat.color}"></span>${escapeHtml(cat.name)}</span>` : ''}
                    ${recurring ? `<span class="task-recurring-badge">🔁 ${recurrenceLabel(taskRef.recurrence)}</span>` : ''}
                </div>
            </div>
            <button class="task-delete-btn" data-action="task-delete"
                    data-task-id="${occ.taskId}" data-date="${occ.dueDate}"
                    aria-label="מחק">✕</button>
        </div>
    `;
}

function recurrenceLabel(r) {
    if (!r) return '';
    if (r.type === 'daily') return 'כל יום';
    if (r.type === 'weekly') {
        if (!r.weekdays || r.weekdays.length === 0) return 'שבועי';
        if (r.weekdays.length === 7) return 'כל יום';
        return 'שבועי';
    }
    if (r.type === 'monthly') return 'חודשי';
    return '';
}

function emptyState(emoji, title, text) {
    return `
        <div class="empty-state">
            <div class="empty-state-emoji">${emoji}</div>
            <div class="empty-state-title">${escapeHtml(title)}</div>
            ${text ? `<div class="empty-state-text">${escapeHtml(text)}</div>` : ''}
        </div>
    `;
}

function renderAllTasksView() {
    // Get all occurrences in a wide range
    const today = todayStr();
    const from = addDays(today, -90);
    const to = addDays(today, 90);
    let occs = getOccurrencesInRange(from, to);

    // Category filter
    occs = filterByCategory(occs);

    // Status filter
    if (state.ui.statusFilter === 'pending') occs = occs.filter(o => !o.done);
    else if (state.ui.statusFilter === 'done') occs = occs.filter(o => o.done);

    occs.sort(sortByDateTime);

    let html = `
        <div class="filter-bar" style="margin: -16px -16px 16px; border-radius: 0;">
            <div class="filter-row">
                <div class="status-pills" style="flex:1">
                    <button class="status-pill ${state.ui.statusFilter === 'all' ? 'active' : ''}" data-action="status" data-status="all">הכל</button>
                    <button class="status-pill ${state.ui.statusFilter === 'pending' ? 'active' : ''}" data-action="status" data-status="pending">פתוחות</button>
                    <button class="status-pill ${state.ui.statusFilter === 'done' ? 'active' : ''}" data-action="status" data-status="done">בוצעו</button>
                </div>
            </div>
        </div>
        <div class="filter-chips" style="margin: -16px -16px 16px; padding: 12px 16px;">
            <button class="chip ${(state.ui.categoryFilter || []).length === 0 ? 'active' : ''}" data-action="filter" data-cat="all">
                <span class="chip-dot"></span>הכל</button>
            ${state.categories.map(c => `
                <button class="chip ${(state.ui.categoryFilter || []).includes(c.id) ? 'active' : ''}" data-action="filter" data-cat="${c.id}">
                    <span class="chip-dot" style="background:${c.color}"></span>${escapeHtml(c.name)}</button>
            `).join('')}
        </div>
    `;

    if (occs.length === 0) {
        html += emptyState('🔍', 'אין משימות', 'נסי להוסיף משימה חדשה');
    } else {
        html += occs.map(o => renderTaskCard(o, o.dueDate === today)).join('');
    }
    return html;
}

function renderCategoriesView() {
    const counts = {};
    for (const t of state.tasks) {
        counts[t.categoryId] = (counts[t.categoryId] || 0) + 1;
    }
    let html = '';
    for (const cat of state.categories) {
        const count = counts[cat.id] || 0;
        html += `
            <div class="category-list-item">
                <div class="category-color-dot" style="background:${cat.color}"></div>
                <div class="category-info">
                    <div class="category-name">${escapeHtml(cat.name)}</div>
                    <div class="category-count">${count} משימות</div>
                </div>
                <button class="icon-btn" data-action="edit-category" data-cat-id="${cat.id}">✏️</button>
                <button class="icon-btn danger" data-action="delete-category" data-cat-id="${cat.id}">🗑️</button>
            </div>
        `;
    }
    html += `
        <button class="btn btn-primary mt-16" data-action="add-category">+ הוסף קטגוריה</button>
    `;
    return html;
}

function renderSettingsView() {
    const taskCount = state.tasks.length;
    const catCount = state.categories.length;
    const compCount = Object.keys(state.completions).length;
    const remindersOn = !!state.settings.remindersEnabled;
    const permState = ('Notification' in window) ? Notification.permission : 'unsupported';
    let permLabel = '';
    if (permState === 'granted') permLabel = '✓ התראות מערכת מאושרות';
    else if (permState === 'denied') permLabel = '⚠️ התראות מערכת חסומות בדפדפן';
    else if (permState === 'default') permLabel = 'ℹ️ הפעלי כדי לקבל אישור לתזכורות';
    else permLabel = 'התראות מערכת לא נתמכות בדפדפן זה';

    return `
        <div class="settings-item">
            <div class="settings-item-label">
                <div class="settings-item-title">📊 סטטיסטיקה</div>
                <div class="settings-item-desc">${taskCount} משימות · ${catCount} קטגוריות · ${compCount} ביצועים</div>
            </div>
        </div>

        <div class="settings-item">
            <div class="settings-item-label">
                <div class="settings-item-title">🔔 תזכורות וצליל</div>
                <div class="settings-item-desc">${permLabel}</div>
            </div>
            <div class="switch ${remindersOn ? 'on' : ''}" data-action="toggle-reminders"></div>
        </div>

        <div class="settings-item" data-action="test-reminder">
            <div class="settings-item-label">
                <div class="settings-item-title">▶️ בדוק תזכורת עכשיו</div>
                <div class="settings-item-desc">תזכורת בדיקה תיפתח בעוד 5 שניות (לוודא צליל + אישור)</div>
            </div>
        </div>

        <div class="settings-item" data-action="check-update">
            <div class="settings-item-label">
                <div class="settings-item-title">🔄 עדכון גרסה</div>
                <div class="settings-item-desc">גרסה נוכחית: ${APP_VERSION} · לחיצה תגבה את הנתונים ותבדוק עדכון</div>
            </div>
            <button class="icon-btn">↻</button>
        </div>

        <div class="settings-item" data-action="clear-all" style="border:1px solid var(--danger-bg);">
            <div class="settings-item-label">
                <div class="settings-item-title" style="color:var(--danger)">🗑️ מחק את כל הנתונים</div>
                <div class="settings-item-desc">פעולה זו אינה הפיכה</div>
            </div>
        </div>
    `;
}

function renderFab() {
    return `<button class="fab" data-action="add-task" aria-label="הוסף משימה">+</button>`;
}

function renderBottomNav() {
    const view = state.ui.view;
    return `
        <nav class="bottom-nav">
            <button class="nav-btn ${view === 'main' ? 'active' : ''}" data-action="nav" data-view="main">
                <span class="nav-btn-icon">🏠</span><span>ראשי</span>
            </button>
            <button class="nav-btn ${view === 'all' ? 'active' : ''}" data-action="nav" data-view="all">
                <span class="nav-btn-icon">📋</span><span>הכל</span>
            </button>
            <button class="nav-btn ${view === 'categories' ? 'active' : ''}" data-action="nav" data-view="categories">
                <span class="nav-btn-icon">🏷️</span><span>קטגוריות</span>
            </button>
            <button class="nav-btn ${view === 'settings' ? 'active' : ''}" data-action="nav" data-view="settings">
                <span class="nav-btn-icon">⚙️</span><span>הגדרות</span>
            </button>
        </nav>
    `;
}

// ===== Event handling =====
function attachEventListeners() {
    $('#app').addEventListener('click', handleAppClick);
}

function handleAppClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    switch (action) {
        case 'nav':
            state.ui.view = el.dataset.view;
            state.ui.categoryFilter = [];
            render();
            break;
        case 'filter':
            toggleCategoryFilter(el.dataset.cat);
            render();
            break;
        case 'status':
            state.ui.statusFilter = el.dataset.status;
            render();
            break;
        case 'toggle-future':
            state.ui.futureExpanded = !state.ui.futureExpanded;
            render();
            break;
        case 'toggle-done':
            handleToggleDone(el.dataset.taskId, el.dataset.date);
            break;
        case 'add-task':
            openTaskModal();
            break;
        case 'task-edit':
            openTaskModal(el.dataset.taskId, el.dataset.date, true);
            break;
        case 'task-delete':
            confirmDeleteTask(el.dataset.taskId, el.dataset.date);
            break;
        case 'add-category':
            openCategoryModal();
            break;
        case 'edit-category':
            openCategoryModal(el.dataset.catId);
            break;
        case 'delete-category':
            handleDeleteCategory(el.dataset.catId);
            break;
        case 'toggle-reminders':
            handleToggleReminders();
            break;
        case 'test-reminder':
            testReminder();
            break;
        case 'check-update':
            checkForUpdate();
            break;
        case 'clear-all':
            handleClearAll();
            break;
    }
}

function handleToggleDone(taskId, dateStr) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const occ = occurrenceFor(task, dateStr);
    setOccurrenceDone(occ, !occ.done);
    render();
    showToast(occ.done ? 'בוטל הסימון' : '✓ סומן כבוצע');
}

// ===== Toast =====
let toastTimer;
function showToast(text) {
    const toast = $('#toast');
    toast.textContent = text;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 1800);
}

// ===== Reminders =====
let scheduledTimeouts = [];
let alertedSet = new Set();
let audioCtx = null;

function loadAlerted() {
    try {
        const raw = localStorage.getItem(ALERTED_KEY);
        if (raw) alertedSet = new Set(JSON.parse(raw));
    } catch (e) {}
    pruneAlertedSet();
}

function saveAlerted() {
    localStorage.setItem(ALERTED_KEY, JSON.stringify(Array.from(alertedSet)));
}

function pruneAlertedSet() {
    const cutoff = addDays(todayStr(), -7);
    let changed = false;
    for (const key of Array.from(alertedSet)) {
        const date = key.split('__')[1];
        if (date && date < cutoff) {
            alertedSet.delete(key);
            changed = true;
        }
    }
    if (changed) saveAlerted();
}

function ensureAudioContext() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    } catch (e) {
        return null;
    }
}

function playReminderSound() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Three-tone ascending chime
    [880, 1175, 1568].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        const t = now + i * 0.15;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.start(t);
        osc.stop(t + 0.5);
    });
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
        const res = await Notification.requestPermission();
        return res === 'granted';
    } catch (e) {
        return false;
    }
}

function showSystemNotification(occ) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const cat = getCategory(occ.categoryId);
    try {
        const n = new Notification(`⏰ ${occ.text}`, {
            body: `🕘 ${occ.dueTime}${cat ? ' · ' + cat.name : ''}`,
            icon: 'icons/icon-192.png',
            badge: 'icons/icon-192.png',
            tag: `${occ.taskId}__${occ.dueDate}`,
            requireInteraction: false
        });
        n.onclick = () => { window.focus(); n.close(); };
    } catch (e) {
        console.warn('Notification failed', e);
    }
    if (navigator.vibrate) {
        try { navigator.vibrate([200, 100, 200, 100, 400]); } catch (e) {}
    }
}

function showReminderModal(occ) {
    const cat = getCategory(occ.categoryId);
    const html = `
        <div class="modal-header">
            <div class="modal-title">⏰ זמן למשימה!</div>
            <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div style="text-align:center;padding:14px 8px 8px">
            <div style="font-size:54px;margin-bottom:10px">⏰</div>
            <div style="font-size:20px;font-weight:700;margin-bottom:8px;line-height:1.3">${escapeHtml(occ.text)}</div>
            <div style="color:var(--text-muted);margin-bottom:8px">🕘 ${occ.dueTime}</div>
            ${cat ? `<div><span class="task-category-tag" style="background:${cat.color}22;color:${cat.color};font-size:12px;padding:3px 10px"><span class="chip-dot" style="background:${cat.color}"></span>${escapeHtml(cat.name)}</span></div>` : ''}
        </div>
        <div class="btn-row">
            <button class="btn btn-secondary" id="snooze-btn">דחה</button>
            <button class="btn btn-primary" id="done-from-alert-btn">✓ סומן כבוצע</button>
        </div>
    `;
    openModal(html);
    const overlay = $('#modal-overlay');
    overlay.querySelector('#snooze-btn').onclick = () => closeModal();
    overlay.querySelector('#done-from-alert-btn').onclick = () => {
        const task = state.tasks.find(t => t.id === occ.taskId);
        if (task) {
            const liveOcc = occurrenceFor(task, occ.dueDate);
            setOccurrenceDone(liveOcc, true);
        }
        closeModal();
        render();
        showToast('✓ סומן כבוצע');
    };
}

function scheduleReminders() {
    scheduledTimeouts.forEach(t => clearTimeout(t));
    scheduledTimeouts = [];

    if (!state.settings || !state.settings.remindersEnabled) return;
    if (!state.tasks) return;

    const now = Date.now();
    const today = todayStr();
    const todayOccs = getOccurrencesOn(today).filter(o => !o.done);

    for (const occ of todayOccs) {
        const key = `${occ.taskId}__${occ.dueDate}`;
        if (alertedSet.has(key)) continue;

        const [h, m] = occ.dueTime.split(':').map(Number);
        const target = new Date();
        target.setHours(h, m, 0, 0);
        const delay = target.getTime() - now;

        if (delay < -60000) continue; // already > 1 min past
        if (delay > REMINDER_SCHEDULE_WINDOW_MS) continue;

        const taskId = occ.taskId;
        const dateStr = occ.dueDate;
        const id = setTimeout(() => triggerReminder(taskId, dateStr), Math.max(0, delay));
        scheduledTimeouts.push(id);
    }
}

function triggerReminder(taskId, dateStr) {
    const key = `${taskId}__${dateStr}`;
    if (alertedSet.has(key)) return;
    if (!state.settings.remindersEnabled) return;

    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const occ = occurrenceFor(task, dateStr);
    if (occ.done) return;
    if (task.exceptions && task.exceptions.includes(dateStr)) return;

    alertedSet.add(key);
    saveAlerted();

    playReminderSound();
    showSystemNotification(occ);
    showReminderModal(occ);
}

// ===== Modal helpers =====
function openModal(html) {
    const overlay = $('#modal-overlay');
    overlay.innerHTML = `<div class="modal" onclick="event.stopPropagation()">${html}</div>`;
    overlay.classList.remove('hidden');
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
}
function closeModal() {
    const overlay = $('#modal-overlay');
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
}

// ===== Task modal =====
// taskId — task being edited (omit for new)
// occurrenceDate — the date of the occurrence the user tapped (used by recurring tasks)
// forceSeriesMode — true to edit the recurring series; false/undefined: edit one occurrence
function openTaskModal(taskId, occurrenceDate, forceSeriesMode) {
    const editing = !!taskId;
    const task = editing ? state.tasks.find(t => t.id === taskId) : null;
    const taskIsRecurring = !!(task && task.recurrence);
    const editingOneOccurrence = !!occurrenceDate && !forceSeriesMode && taskIsRecurring;
    const showTabs = editing && taskIsRecurring;

    const defaultDate = editingOneOccurrence ? occurrenceDate : (task ? task.dueDate : todayStr());
    const defaultTime = task ? task.dueTime : DEFAULT_TIME;
    const defaultCat = task ? task.categoryId : (state.categories[0]?.id || '');
    const defaultText = task ? task.text : '';

    const showRecurringSection = !editingOneOccurrence;
    const recurring = !editingOneOccurrence && taskIsRecurring;
    const rType = recurring ? task.recurrence.type : 'daily';
    const rWeekdays = (recurring && task.recurrence.weekdays) ? task.recurrence.weekdays : [];
    const rCount = recurring ? (task.recurrence.count || DEFAULT_RECURRENCE_COUNT) : DEFAULT_RECURRENCE_COUNT;
    const rEndType = recurring ? (task.recurrence.endType || 'count') : 'count';
    const rUntil = recurring ? (task.recurrence.until || addDays(todayStr(), 30)) : addDays(todayStr(), 30);

    const title = editingOneOccurrence ? 'ערוך מופע יחיד'
        : (editing ? (taskIsRecurring ? 'ערוך את כל הסדרה' : 'ערוך משימה') : 'משימה חדשה');
    const saveLabel = editingOneOccurrence ? 'שמור כמופע נפרד'
        : (editing ? 'שמור' : 'הוסף משימה');

    const catOptions = state.categories.map(c =>
        `<option value="${c.id}" ${c.id === defaultCat ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');

    const html = `
        <div class="modal-header">
            <div class="modal-title">${title}</div>
            <button class="modal-close" onclick="closeModal()">✕</button>
        </div>

        ${showTabs ? `
            <div class="modal-tabs">
                <button class="modal-tab ${!editingOneOccurrence ? 'active' : ''}" data-mode-tab="series">ערוך את כל הסדרה</button>
                <button class="modal-tab ${editingOneOccurrence ? 'active' : ''}" data-mode-tab="occurrence">ערוך רק מופע זה</button>
            </div>
        ` : ''}

        ${editingOneOccurrence ? `
            <div style="background:var(--teal-bg);padding:10px 12px;border-radius:10px;margin-bottom:14px;font-size:13px;color:var(--teal-dark);line-height:1.4;">
                ℹ️ עריכת המופע הזה תיצור משימה נפרדת ל-${prettyDate(occurrenceDate)} בלבד. שאר הסדרה לא תושפע.
            </div>
        ` : ''}

        <div class="form-group">
            <label class="form-label">מה צריך לעשות?</label>
            <textarea class="form-textarea" id="task-text" placeholder="לדוגמה: לקנות חלב">${escapeHtml(defaultText)}</textarea>
        </div>

        <div class="form-group">
            <label class="form-label">קטגוריה</label>
            <div class="category-row">
                <select class="form-select" id="task-category">${catOptions}</select>
                <button type="button" class="new-category-btn" id="toggle-new-cat">+ חדשה</button>
            </div>
            <div class="new-category-inputs hidden" id="new-cat-block">
                <input type="text" class="form-input" id="new-cat-name" placeholder="שם הקטגוריה">
                <div class="color-palette" id="new-cat-colors">
                    ${CATEGORY_COLORS.map((c, i) => `<div class="color-swatch ${i === 0 ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>`).join('')}
                </div>
            </div>
        </div>

        <div class="form-group">
            <label class="form-label">תאריך ושעת יעד</label>
            <div class="form-row">
                <input type="date" class="form-input" id="task-date" value="${defaultDate}">
                <input type="time" class="form-input" id="task-time" value="${defaultTime}">
            </div>
            <div class="quick-date-buttons">
                <button type="button" class="quick-date-btn" data-quick="0">היום</button>
                <button type="button" class="quick-date-btn" data-quick="1">מחר</button>
                <button type="button" class="quick-date-btn" data-quick="7">בעוד שבוע</button>
            </div>
        </div>

        ${showRecurringSection ? `
        <div class="form-group">
            <div class="toggle-row">
                <label class="form-label" style="margin:0">🔁 משימה חוזרת</label>
                <div class="switch ${recurring ? 'on' : ''}" id="recurring-switch"></div>
            </div>
            <div class="recurrence-options ${recurring ? '' : 'hidden'}" id="recurrence-options">
                <select class="form-select" id="recurrence-type">
                    <option value="daily" ${rType === 'daily' ? 'selected' : ''}>כל יום</option>
                    <option value="weekly" ${rType === 'weekly' ? 'selected' : ''}>שבועי (בחר ימים)</option>
                    <option value="monthly" ${rType === 'monthly' ? 'selected' : ''}>פעם בחודש</option>
                </select>
                <div class="weekdays-row ${rType === 'weekly' ? '' : 'hidden'}" id="weekdays-row">
                    ${WEEKDAY_LABELS.map((lbl, i) => `
                        <button type="button" class="weekday-btn ${rWeekdays.includes(i) ? 'active' : ''}" data-day="${i}">${lbl}</button>
                    `).join('')}
                </div>
                <div style="margin-top:12px">
                    <label class="form-label">מתי לסיים?</label>
                    <select class="form-select" id="recurrence-end-type">
                        <option value="count" ${rEndType === 'count' ? 'selected' : ''}>אחרי מספר חזרות</option>
                        <option value="until" ${rEndType === 'until' ? 'selected' : ''}>בתאריך מסוים</option>
                        <option value="forever" ${rEndType === 'forever' ? 'selected' : ''}>לתמיד (ללא סוף)</option>
                    </select>
                    <div class="${rEndType === 'count' ? '' : 'hidden'}" id="end-count-block" style="margin-top:8px">
                        <input type="number" class="form-input" id="recurrence-count" value="${rCount}" min="1" max="${MAX_RECURRENCE_COUNT}" placeholder="כמה פעמים">
                    </div>
                    <div class="${rEndType === 'until' ? '' : 'hidden'}" id="end-until-block" style="margin-top:8px">
                        <input type="date" class="form-input" id="recurrence-until" value="${rUntil}">
                    </div>
                </div>
            </div>
        </div>
        ` : ''}

        <div class="btn-row">
            <button class="btn btn-primary" id="save-task-btn">${saveLabel}</button>
        </div>
    `;

    openModal(html);
    wireTaskModal(taskId, occurrenceDate, forceSeriesMode);
}

function wireTaskModal(taskId, occurrenceDate, forceSeriesMode) {
    const overlay = $('#modal-overlay');
    let selectedColor = CATEGORY_COLORS[0];
    let newCatOpen = false;

    overlay.querySelectorAll('[data-mode-tab]').forEach(tab => {
        tab.onclick = () => {
            if (tab.dataset.modeTab === 'series') openTaskModal(taskId, occurrenceDate, true);
            else openTaskModal(taskId, occurrenceDate, false);
        };
    });

    overlay.querySelector('#toggle-new-cat').onclick = () => {
        newCatOpen = !newCatOpen;
        overlay.querySelector('#new-cat-block').classList.toggle('hidden', !newCatOpen);
    };

    overlay.querySelectorAll('#new-cat-colors .color-swatch').forEach(sw => {
        sw.onclick = () => {
            overlay.querySelectorAll('#new-cat-colors .color-swatch').forEach(s => s.classList.remove('selected'));
            sw.classList.add('selected');
            selectedColor = sw.dataset.color;
        };
    });

    overlay.querySelectorAll('.quick-date-btn').forEach(b => {
        b.onclick = () => {
            const dateInput = overlay.querySelector('#task-date');
            dateInput.value = addDays(todayStr(), parseInt(b.dataset.quick));
        };
    });

    const recSwitch = overlay.querySelector('#recurring-switch');
    if (recSwitch) {
        recSwitch.onclick = () => {
            recSwitch.classList.toggle('on');
            overlay.querySelector('#recurrence-options').classList.toggle('hidden', !recSwitch.classList.contains('on'));
        };
    }

    const recType = overlay.querySelector('#recurrence-type');
    if (recType) {
        recType.onchange = () => {
            overlay.querySelector('#weekdays-row').classList.toggle('hidden', recType.value !== 'weekly');
        };
    }

    overlay.querySelectorAll('.weekday-btn').forEach(btn => {
        btn.onclick = () => btn.classList.toggle('active');
    });

    const endTypeSelect = overlay.querySelector('#recurrence-end-type');
    if (endTypeSelect) {
        endTypeSelect.onchange = () => {
            const v = endTypeSelect.value;
            overlay.querySelector('#end-count-block').classList.toggle('hidden', v !== 'count');
            overlay.querySelector('#end-until-block').classList.toggle('hidden', v !== 'until');
        };
    }

    overlay.querySelector('#save-task-btn').onclick = () => {
        saveTaskFromModal(taskId, occurrenceDate, forceSeriesMode, newCatOpen ? selectedColor : null);
    };
}

function saveTaskFromModal(taskId, occurrenceDate, forceSeriesMode, newCatColor) {
    const overlay = $('#modal-overlay');
    const text = overlay.querySelector('#task-text').value.trim();
    const date = overlay.querySelector('#task-date').value;
    const time = overlay.querySelector('#task-time').value || DEFAULT_TIME;
    let catId = overlay.querySelector('#task-category').value;
    const newCatName = overlay.querySelector('#new-cat-name').value.trim();

    const recSwitch = overlay.querySelector('#recurring-switch');
    const isRecurring = !!(recSwitch && recSwitch.classList.contains('on'));
    const recTypeEl = overlay.querySelector('#recurrence-type');
    const recType = recTypeEl ? recTypeEl.value : 'daily';
    const weekdays = Array.from(overlay.querySelectorAll('.weekday-btn.active')).map(b => parseInt(b.dataset.day));

    const endTypeEl = overlay.querySelector('#recurrence-end-type');
    const endType = endTypeEl ? endTypeEl.value : 'count';
    const recCountEl = overlay.querySelector('#recurrence-count');
    const recCount = recCountEl
        ? Math.max(1, Math.min(MAX_RECURRENCE_COUNT, parseInt(recCountEl.value) || DEFAULT_RECURRENCE_COUNT))
        : DEFAULT_RECURRENCE_COUNT;
    const recUntilEl = overlay.querySelector('#recurrence-until');
    const recUntil = recUntilEl ? recUntilEl.value : null;

    if (!text) { showToast('נא להזין טקסט למשימה'); return; }
    if (!date) { showToast('נא לבחור תאריך'); return; }

    if (newCatName && newCatColor) {
        const newCat = { id: newId('cat'), name: newCatName, color: newCatColor };
        state.categories.push(newCat);
        catId = newCat.id;
    }
    if (!catId) { showToast('נא לבחור קטגוריה'); return; }

    let recurrence = null;
    if (isRecurring) {
        recurrence = { type: recType, endType };
        if (recType === 'weekly') {
            recurrence.weekdays = weekdays.length > 0 ? weekdays : [dayOfWeek(date)];
        }
        if (endType === 'count') {
            recurrence.count = recCount;
        } else if (endType === 'until') {
            if (!recUntil) { showToast('נא לבחור תאריך סיום'); return; }
            if (recUntil < date) { showToast('תאריך הסיום חייב להיות אחרי תאריך ההתחלה'); return; }
            recurrence.until = recUntil;
        }
        // 'forever' has no extra fields
    }

    // Determine mode for editing
    const origTask = taskId ? state.tasks.find(t => t.id === taskId) : null;
    const taskWasRecurring = !!(origTask && origTask.recurrence);
    const editingOneOccurrence = !!occurrenceDate && !forceSeriesMode && taskWasRecurring;

    if (editingOneOccurrence) {
        // Mark original occurrence as exception + create new one-off task
        if (origTask) {
            if (!origTask.exceptions) origTask.exceptions = [];
            if (!origTask.exceptions.includes(occurrenceDate)) {
                origTask.exceptions.push(occurrenceDate);
            }
            delete state.completions[`${taskId}__${occurrenceDate}`];
        }
        state.tasks.push({
            id: newId('task'),
            text, categoryId: catId, dueDate: date, dueTime: time,
            done: false, doneAt: null, recurrence: null, exceptions: [],
            createdAt: new Date().toISOString()
        });
        saveState();
        closeModal();
        render();
        showToast('המופע עודכן');
        return;
    }

    if (taskId) {
        const task = state.tasks.find(t => t.id === taskId);
        task.text = text;
        task.categoryId = catId;
        task.dueDate = date;
        task.dueTime = time;
        task.recurrence = recurrence;
        if (!recurrence) task.exceptions = [];
    } else {
        state.tasks.push({
            id: newId('task'),
            text, categoryId: catId, dueDate: date, dueTime: time,
            done: false, doneAt: null, recurrence, exceptions: [],
            createdAt: new Date().toISOString()
        });
    }
    saveState();
    closeModal();
    render();
    showToast(taskId ? 'עודכן' : 'נוסף');
}

// ===== Delete confirmation (X button) =====
function confirmDeleteTask(taskId, dateStr) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    if (!task.recurrence) {
        if (confirm(`למחוק את "${task.text}"?`)) {
            deleteEntireTask(taskId);
        }
        return;
    }

    const totalOccs = getTaskOccurrenceDates(task).length;
    const html = `
        <div class="modal-header">
            <div class="modal-title">מחיקת משימה</div>
            <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div style="padding: 0 4px 14px">
            <div style="font-weight: 600; margin-bottom: 4px">${escapeHtml(task.text)}</div>
            <div style="color: var(--text-muted); font-size: 13px">🔁 משימה חוזרת · ${totalOccs} מופעים</div>
        </div>
        <button class="action-sheet-item danger" data-action="del-occ">🗑️ מחק רק את המופע של ${prettyDate(dateStr)}</button>
        <button class="action-sheet-item danger" data-action="del-series">🗑️ מחק את כל הסדרה</button>
        <button class="action-sheet-item" data-action="cancel">ביטול</button>
    `;
    openModal(html);
    const overlay = $('#modal-overlay');
    overlay.querySelector('[data-action="del-occ"]').onclick = () => deleteOccurrenceOnly(taskId, dateStr);
    overlay.querySelector('[data-action="del-series"]').onclick = () => deleteEntireTask(taskId);
    overlay.querySelector('[data-action="cancel"]').onclick = () => closeModal();
}

function deleteOccurrenceOnly(taskId, dateStr) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    if (!task.exceptions) task.exceptions = [];
    if (!task.exceptions.includes(dateStr)) task.exceptions.push(dateStr);
    delete state.completions[`${taskId}__${dateStr}`];
    saveState();
    closeModal();
    render();
    showToast('המופע נמחק');
}

function deleteEntireTask(taskId) {
    state.tasks = state.tasks.filter(t => t.id !== taskId);
    Object.keys(state.completions).forEach(k => {
        if (k.startsWith(taskId + '__')) delete state.completions[k];
    });
    saveState();
    closeModal();
    render();
    showToast('נמחק');
}

// ===== Category modal =====
function openCategoryModal(catId) {
    const editing = !!catId;
    const cat = editing ? state.categories.find(c => c.id === catId) : null;
    const defaultName = cat ? cat.name : '';
    const defaultColor = cat ? cat.color : CATEGORY_COLORS[0];

    const html = `
        <div class="modal-header">
            <div class="modal-title">${editing ? 'ערוך קטגוריה' : 'קטגוריה חדשה'}</div>
            <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="form-group">
            <label class="form-label">שם</label>
            <input type="text" class="form-input" id="cat-name" value="${escapeHtml(defaultName)}" placeholder="שם הקטגוריה">
        </div>
        <div class="form-group">
            <label class="form-label">צבע</label>
            <div class="color-palette" id="cat-color-palette">
                ${CATEGORY_COLORS.map(c => `<div class="color-swatch ${c === defaultColor ? 'selected' : ''}" style="background:${c}" data-color="${c}"></div>`).join('')}
            </div>
        </div>
        <button class="btn btn-primary" id="save-cat-btn">${editing ? 'שמור' : 'הוסף'}</button>
    `;
    openModal(html);

    const overlay = $('#modal-overlay');
    let selectedColor = defaultColor;
    overlay.querySelectorAll('#cat-color-palette .color-swatch').forEach(sw => {
        sw.onclick = () => {
            overlay.querySelectorAll('#cat-color-palette .color-swatch').forEach(s => s.classList.remove('selected'));
            sw.classList.add('selected');
            selectedColor = sw.dataset.color;
        };
    });

    overlay.querySelector('#save-cat-btn').onclick = () => {
        const name = overlay.querySelector('#cat-name').value.trim();
        if (!name) { showToast('נא להזין שם'); return; }
        if (editing) {
            cat.name = name;
            cat.color = selectedColor;
        } else {
            state.categories.push({ id: newId('cat'), name, color: selectedColor });
        }
        saveState();
        closeModal();
        render();
        showToast(editing ? 'עודכן' : 'נוסף');
    };
}

function handleDeleteCategory(catId) {
    const inUse = state.tasks.filter(t => t.categoryId === catId).length;
    let msg = 'למחוק את הקטגוריה?';
    if (inUse > 0) msg += `\nיש ${inUse} משימות בקטגוריה זו — הן יימחקו גם הן.`;
    if (!confirm(msg)) return;
    state.tasks = state.tasks.filter(t => t.categoryId !== catId);
    state.categories = state.categories.filter(c => c.id !== catId);
    saveState();
    render();
    showToast('נמחק');
}

// ===== Test reminder (diagnostic) =====
async function testReminder() {
    await requestNotificationPermission();
    ensureAudioContext();
    showToast('תזכורת בדיקה בעוד 5 שניות…');
    const testOcc = {
        taskId: '__test__',
        text: 'תזכורת בדיקה ✅',
        dueDate: todayStr(),
        dueTime: 'בדיקה',
        categoryId: state.categories[0] ? state.categories[0].id : null
    };
    setTimeout(() => {
        playReminderSound();
        showSystemNotification(testOcc);
        showReminderModal(testOcc);
    }, 5000);
}

// ===== Reminders toggle =====
async function handleToggleReminders() {
    if (!state.settings.remindersEnabled) {
        // Turning ON — request permission if not already
        const granted = await requestNotificationPermission();
        state.settings.remindersEnabled = true;
        saveState();
        render();
        if (granted) showToast('✓ תזכורות מופעלות');
        else if ('Notification' in window && Notification.permission === 'denied') {
            showToast('יש להפעיל התראות בהגדרות הדפדפן');
        } else {
            showToast('✓ תזכורות מופעלות (בתוך האפליקציה)');
        }
        ensureAudioContext();
    } else {
        state.settings.remindersEnabled = false;
        scheduledTimeouts.forEach(t => clearTimeout(t));
        scheduledTimeouts = [];
        saveState();
        render();
        showToast('תזכורות כובו');
    }
}

// ===== Version update (with automatic snapshot backup) =====
function snapshotBackup() {
    const data = {
        appVersion: APP_VERSION,
        backedUpAt: new Date().toISOString(),
        categories: state.categories,
        tasks: state.tasks,
        completions: state.completions,
        settings: state.settings
    };
    try {
        localStorage.setItem(SAFETY_BACKUP_KEY, JSON.stringify(data));
        return true;
    } catch (e) {
        console.warn('Snapshot failed', e);
        return false;
    }
}

async function checkForUpdate() {
    snapshotBackup();
    showToast('🔄 הנתונים גובו · מוריד גרסה חדשה…');

    try {
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) {
                await reg.update();
                if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
        }
    } catch (e) {
        console.warn('SW update failed', e);
    }

    // Force a fresh load with cache-busting query string —
    // this bypasses any stale HTTP cache that might be holding old code.
    setTimeout(() => {
        const url = location.pathname + '?v=' + Date.now();
        location.replace(url);
    }, 1200);
}

function handleClearAll() {
    if (!confirm('למחוק את כל המשימות והקטגוריות? פעולה זו אינה הפיכה.')) return;
    if (!confirm('האם את בטוחה? כל הנתונים יימחקו.')) return;
    state.categories = [...DEFAULT_CATEGORIES];
    state.tasks = [];
    state.completions = {};
    state.ui.categoryFilter = [];
    saveState();
    render();
    showToast('הכל נמחק');
}

// ===== Utility =====
function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// expose closeModal to inline onclick handlers
window.closeModal = closeModal;

// ===== Service worker registration =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW failed', err));
    });
}

// ===== Init =====
loadState();
loadAlerted();
render();
scheduleReminders();

// Re-check schedule every 2 minutes (catches drift, new tasks, etc.)
setInterval(scheduleReminders, 2 * 60 * 1000);

// Re-schedule when app comes back into focus
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        pruneAlertedSet();
        scheduleReminders();
    }
});

// Prime AudioContext on first user gesture (browsers block autoplay otherwise)
['click', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, () => ensureAudioContext(), { once: true });
});
