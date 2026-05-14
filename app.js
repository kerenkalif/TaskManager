/* ============================================================
   המשימות שלי — Application Logic
   ============================================================ */

// ===== Constants =====
const STORAGE_KEY = 'taskmanager_v1';
const DEFAULT_TIME = '09:00';
const OVERDUE_LOOKBACK_DAYS = 14;
const FUTURE_LOOKAHEAD_DAYS = 30;

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
    ui: {
        view: 'main',
        categoryFilter: 'all',
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
        completions: state.completions
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ===== ID helper =====
function newId(prefix) {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

// ===== Recurring task expansion =====
// Returns true if a recurring task should occur on a given date
function recurrenceHits(task, dateStr) {
    if (!task.recurrence) return dateStr === task.dueDate;
    if (dateStr < task.dueDate) return false;
    if (task.until && dateStr > task.until) return false;

    const r = task.recurrence;
    if (r.type === 'daily') {
        return true;
    }
    if (r.type === 'weekly') {
        const dow = dayOfWeek(dateStr);
        // if weekdays not specified, use the dueDate's day of week
        const days = (r.weekdays && r.weekdays.length > 0)
            ? r.weekdays
            : [dayOfWeek(task.dueDate)];
        return days.includes(dow);
    }
    if (r.type === 'monthly') {
        const targetDay = parseDate(task.dueDate).getDate();
        const thisDay = parseDate(dateStr).getDate();
        return targetDay === thisDay;
    }
    return false;
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
        if (task.recurrence) {
            // expand
            let d = fromDate < task.dueDate ? task.dueDate : fromDate;
            while (d <= toDate) {
                if (recurrenceHits(task, d)) {
                    out.push(occurrenceFor(task, d));
                }
                d = addDays(d, 1);
            }
        } else {
            if (task.dueDate >= fromDate && task.dueDate <= toDate) {
                out.push(occurrenceFor(task, task.dueDate));
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
    if (state.ui.categoryFilter === 'all') return occurrences;
    return occurrences.filter(o => o.categoryId === state.ui.categoryFilter);
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
    let html = '<div class="filter-chips">';
    const allActive = state.ui.categoryFilter === 'all';
    html += `<button class="chip ${allActive ? 'active' : ''}" data-action="filter" data-cat="all">
        <span class="chip-dot"></span>הכל</button>`;
    for (const cat of state.categories) {
        const active = state.ui.categoryFilter === cat.id;
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
            <div class="task-body">
                <div class="task-text">${escapeHtml(occ.text)}</div>
                <div class="task-meta">
                    <span class="task-time">🕘 ${occ.dueTime}</span>
                    ${!isToday ? `<span>· ${prettyDate(occ.dueDate)}</span>` : ''}
                    ${cat ? `<span class="task-category-tag" style="background:${cat.color}22;color:${cat.color}">
                        <span class="chip-dot" style="background:${cat.color}"></span>${escapeHtml(cat.name)}</span>` : ''}
                    ${recurring ? `<span class="task-recurring-badge">🔁 ${recurrenceLabel(taskRef.recurrence)}</span>` : ''}
                </div>
            </div>
            <button class="task-menu-btn" data-action="task-menu" data-task-id="${occ.taskId}" data-date="${occ.dueDate}">⋮</button>
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
            <button class="chip ${state.ui.categoryFilter === 'all' ? 'active' : ''}" data-action="filter" data-cat="all">
                <span class="chip-dot"></span>הכל</button>
            ${state.categories.map(c => `
                <button class="chip ${state.ui.categoryFilter === c.id ? 'active' : ''}" data-action="filter" data-cat="${c.id}">
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
    return `
        <div class="settings-item">
            <div class="settings-item-label">
                <div class="settings-item-title">📊 סטטיסטיקה</div>
                <div class="settings-item-desc">${taskCount} משימות · ${catCount} קטגוריות · ${compCount} ביצועים</div>
            </div>
        </div>
        <div class="settings-item" data-action="export">
            <div class="settings-item-label">
                <div class="settings-item-title">💾 גיבוי הנתונים</div>
                <div class="settings-item-desc">הורד קובץ JSON עם כל המשימות והקטגוריות</div>
            </div>
            <button class="icon-btn">⬇️</button>
        </div>
        <div class="settings-item" data-action="import">
            <div class="settings-item-label">
                <div class="settings-item-title">📥 שחזור מגיבוי</div>
                <div class="settings-item-desc">העלה קובץ גיבוי קודם</div>
            </div>
            <button class="icon-btn">⬆️</button>
        </div>
        <div class="settings-item" data-action="clear-all" style="border:1px solid var(--danger-bg);">
            <div class="settings-item-label">
                <div class="settings-item-title" style="color:var(--danger)">🗑️ מחק את כל הנתונים</div>
                <div class="settings-item-desc">פעולה זו אינה הפיכה</div>
            </div>
        </div>
        <input type="file" id="import-file" accept="application/json" style="display:none">
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
            state.ui.categoryFilter = 'all';
            render();
            break;
        case 'filter':
            state.ui.categoryFilter = el.dataset.cat;
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
        case 'task-menu':
            openTaskMenu(el.dataset.taskId, el.dataset.date);
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
        case 'export':
            exportData();
            break;
        case 'import':
            triggerImport();
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
function openTaskModal(taskId) {
    const editing = !!taskId;
    const task = editing ? state.tasks.find(t => t.id === taskId) : null;

    const defaultDate = task ? task.dueDate : todayStr();
    const defaultTime = task ? task.dueTime : DEFAULT_TIME;
    const defaultCat = task ? task.categoryId : (state.categories[0]?.id || '');
    const defaultText = task ? task.text : '';
    const recurring = task && task.recurrence;
    const rType = recurring ? task.recurrence.type : 'daily';
    const rWeekdays = recurring && task.recurrence.weekdays ? task.recurrence.weekdays : [];

    const catOptions = state.categories.map(c =>
        `<option value="${c.id}" ${c.id === defaultCat ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');

    const html = `
        <div class="modal-header">
            <div class="modal-title">${editing ? 'ערוך משימה' : 'משימה חדשה'}</div>
            <button class="modal-close" onclick="closeModal()">✕</button>
        </div>

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
            </div>
        </div>

        <div class="btn-row">
            ${editing ? '<button class="btn btn-danger" id="delete-task-btn">מחק</button>' : ''}
            <button class="btn btn-primary" id="save-task-btn">${editing ? 'שמור' : 'הוסף משימה'}</button>
        </div>
    `;

    openModal(html);
    wireTaskModal(taskId);
}

function wireTaskModal(taskId) {
    const overlay = $('#modal-overlay');
    let selectedColor = CATEGORY_COLORS[0];
    let newCatOpen = false;

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
    recSwitch.onclick = () => {
        recSwitch.classList.toggle('on');
        overlay.querySelector('#recurrence-options').classList.toggle('hidden', !recSwitch.classList.contains('on'));
    };

    const recType = overlay.querySelector('#recurrence-type');
    recType.onchange = () => {
        overlay.querySelector('#weekdays-row').classList.toggle('hidden', recType.value !== 'weekly');
    };

    overlay.querySelectorAll('.weekday-btn').forEach(btn => {
        btn.onclick = () => btn.classList.toggle('active');
    });

    overlay.querySelector('#save-task-btn').onclick = () => {
        saveTaskFromModal(taskId, newCatOpen ? selectedColor : null);
    };

    if (taskId) {
        overlay.querySelector('#delete-task-btn').onclick = () => {
            if (confirm('למחוק את המשימה?')) {
                state.tasks = state.tasks.filter(t => t.id !== taskId);
                // Also clean up its completions
                Object.keys(state.completions).forEach(k => {
                    if (k.startsWith(taskId + '__')) delete state.completions[k];
                });
                saveState();
                closeModal();
                render();
                showToast('המשימה נמחקה');
            }
        };
    }
}

function saveTaskFromModal(taskId, newCatColor) {
    const overlay = $('#modal-overlay');
    const text = overlay.querySelector('#task-text').value.trim();
    const date = overlay.querySelector('#task-date').value;
    const time = overlay.querySelector('#task-time').value || DEFAULT_TIME;
    let catId = overlay.querySelector('#task-category').value;
    const newCatName = overlay.querySelector('#new-cat-name').value.trim();
    const isRecurring = overlay.querySelector('#recurring-switch').classList.contains('on');
    const recType = overlay.querySelector('#recurrence-type').value;
    const weekdays = Array.from(overlay.querySelectorAll('.weekday-btn.active')).map(b => parseInt(b.dataset.day));

    if (!text) { showToast('נא להזין טקסט למשימה'); return; }
    if (!date) { showToast('נא לבחור תאריך'); return; }

    // Create new category if needed
    if (newCatName && newCatColor) {
        const newCat = { id: newId('cat'), name: newCatName, color: newCatColor };
        state.categories.push(newCat);
        catId = newCat.id;
    }

    if (!catId) { showToast('נא לבחור קטגוריה'); return; }

    let recurrence = null;
    if (isRecurring) {
        recurrence = { type: recType };
        if (recType === 'weekly') {
            recurrence.weekdays = weekdays.length > 0 ? weekdays : [dayOfWeek(date)];
        }
    }

    if (taskId) {
        const task = state.tasks.find(t => t.id === taskId);
        task.text = text;
        task.categoryId = catId;
        task.dueDate = date;
        task.dueTime = time;
        task.recurrence = recurrence;
    } else {
        state.tasks.push({
            id: newId('task'),
            text, categoryId: catId, dueDate: date, dueTime: time,
            done: false, doneAt: null, recurrence,
            createdAt: new Date().toISOString()
        });
    }
    saveState();
    closeModal();
    render();
    showToast(taskId ? 'עודכן' : 'נוסף');
}

// ===== Task menu (action sheet) =====
function openTaskMenu(taskId, dateStr) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const html = `
        <div class="modal-header">
            <div class="modal-title">${escapeHtml(task.text)}</div>
            <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <button class="action-sheet-item" data-action="edit-task">✏️ ערוך</button>
        <button class="action-sheet-item danger" data-action="delete-task">🗑️ מחק</button>
    `;
    openModal(html);
    const overlay = $('#modal-overlay');
    overlay.querySelector('[data-action="edit-task"]').onclick = () => {
        closeModal();
        openTaskModal(taskId);
    };
    overlay.querySelector('[data-action="delete-task"]').onclick = () => {
        if (confirm('למחוק את המשימה?' + (task.recurrence ? ' (כולל כל החזרות העתידיות)' : ''))) {
            state.tasks = state.tasks.filter(t => t.id !== taskId);
            Object.keys(state.completions).forEach(k => {
                if (k.startsWith(taskId + '__')) delete state.completions[k];
            });
            saveState();
            closeModal();
            render();
            showToast('המשימה נמחקה');
        }
    };
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

// ===== Export / Import =====
function exportData() {
    const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        categories: state.categories,
        tasks: state.tasks,
        completions: state.completions
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tasks-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('הקובץ הורד');
}

function triggerImport() {
    const input = $('#import-file');
    input.click();
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                if (!confirm('פעולה זו תחליף את כל הנתונים הנוכחיים. להמשיך?')) return;
                state.categories = data.categories || [];
                state.tasks = data.tasks || [];
                state.completions = data.completions || {};
                saveState();
                render();
                showToast('הנתונים שוחזרו');
            } catch (err) {
                showToast('קובץ לא תקין');
            }
        };
        reader.readAsText(file);
    };
}

function handleClearAll() {
    if (!confirm('למחוק את כל המשימות והקטגוריות? פעולה זו אינה הפיכה.')) return;
    if (!confirm('האם את בטוחה? כל הנתונים יימחקו.')) return;
    state.categories = [...DEFAULT_CATEGORIES];
    state.tasks = [];
    state.completions = {};
    state.ui.categoryFilter = 'all';
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
render();
