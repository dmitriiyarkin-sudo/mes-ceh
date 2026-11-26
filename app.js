const YANDEX_PROXY_URL = 'https://' + 'functions.' + 'yandexcloud.net/' + 'd4eaok3ahk50paaqnbla';
const DIRECT_SUPABASE_URL = 'https://' + 'zyviacyiefktjluhhdtf.' + 'supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PlxBXL2o1RQttVyIz3YYXA_x5nWq52f';

let activeChannel = 'yandex';
let state = {
  user: null, workshops: [], shifts: [], workers: [], models: [], variants: [], allowances: [], tasks: [],
  materials: [], bom: [], fgStock: [], salesOrders: [],
  modalWorker: null, modalSlot: 1, editingTask: null, editingOrderId: null, pollTimer: null
};

function buildUrl(path, channel) {
  const sep = path.includes('?') ? '&' : '?';
  const pathWithKey = path + sep + 'apikey=' + encodeURIComponent(SUPABASE_ANON_KEY);
  if (channel === 'direct') return DIRECT_SUPABASE_URL + '/rest/v1/' + pathWithKey;
  const parts = pathWithKey.split('?');
  const tableOrRpc = parts.shift();
  const queryPart = parts.join('?');
  return YANDEX_PROXY_URL + '?p=' + encodeURIComponent(tableOrRpc) + (queryPart ? '&' + queryPart : '');
}

async function sbFetch(path, options) {
  const opts = options || {};
  const headers = Object.assign({
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json'
  }, opts.headers || {});

  const channels = activeChannel === 'yandex' ? ['yandex', 'direct'] : ['direct', 'yandex'];
  let res = null, lastErr = null;
  for (const ch of channels) {
    try {
      res = await fetch(buildUrl(path, ch), Object.assign({}, opts, { headers }));
      activeChannel = ch;
      break;
    } catch (e) { lastErr = e; }
  }
  if (!res) throw lastErr || new Error('Нет соединения с сервером');

  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  if (!res.ok) throw new Error((data && data.message) ? data.message : ('Ошибка HTTP ' + res.status));
  return data;
}

function el(id) { return document.getElementById(id); }
function roleName(r) { return r === 'admin' ? 'Офис / Рук.' : (r === 'otk' ? 'ОТК / Ст. мастер' : 'Мастер цеха'); }
function fmtDateRu(iso) {
  if (!iso) return '—';
  const p = String(iso).split('-');
  return p.length === 3 ? (p + '.' + p + '.' + p) : iso;
}

function applyCatalogData(data) {
  state.workshops = data.workshops || []; state.shifts = data.shifts || [];
  state.workers = data.workers || []; state.models = data.models || [];
  state.variants = data.variants || []; state.allowances = data.allowances || [];
  if (!state.workers.length) return false;

  const wOpts = state.workshops.map(w => '<option value="' + w.id + '">' + w.name + '</option>').join('');
  const mOpts = state.models.map(m => '<option value="' + m.id + '">' + m.name + '</option>').join('');
  el('selWorkshop').innerHTML = wOpts;
  el('nwWorkshop').innerHTML = wOpts;
  el('selShift').innerHTML = state.shifts.map(s => '<option value="' + s.id + '">' + s.name + '</option>').join('');
  el('catModelSel').innerHTML = mOpts;
  el('oModel').innerHTML = mOpts;
  el('bomModel').innerHTML = mOpts;
  onOrderModelChange(); onBomModelChange();
  return true;
}

function enterAppAs(found) {
  state.user = found;
  try { localStorage.setItem('mes_user_id', String(found.id)); } catch (e) {}
  el('loginErr').innerText = ''; el('pinInp').value = '';
  el('loginView').classList.add('hidden');
  el('appView').classList.remove('hidden');
  el('userBadge').innerHTML = '👤 <b>' + found.name + '</b> (' + roleName(found.role) + ')';

  const isAdmin = found.role === 'admin';
  const isWorker = found.role === 'worker';

  el('nav-fg').classList.toggle('hidden', isWorker);
  el('nav-mat').classList.toggle('hidden', isWorker);
  el('nav-forecast').classList.toggle('hidden', isWorker);
  el('nav-catalog').classList.toggle('hidden', !isAdmin);
  el('btnRollover').classList.toggle('hidden', !isAdmin);

  el('nav-schedule').innerText = isWorker ? '📋 Моё задание' : '📅 Цеха и смены';
  el('nav-report').innerText = isWorker ? '📊 Моя статистика' : '📊 Отчет и ABC';

  const wsBlock = el('selWorkshop').parentElement;
  if (wsBlock) wsBlock.classList.toggle('hidden', isWorker);

  if (found.workshop_id) el('selWorkshop').value = found.workshop_id;
  if (!isWorker) renderCatalogWorkers();
  switchTab('schedule');
  loadTasks();

  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => { if (!el('appView').classList.contains('hidden')) loadTasks(); }, 10000);
}

async function bootstrap() {
  el('selDate').value = new Date().toISOString().slice(0, 10);
  el('repMonth').value = new Date().toISOString().slice(0, 7);
  const loginBtn = el('btnLogin');
  el('loginErr').innerText = '';

  let savedUserId = null;
  try { savedUserId = localStorage.getItem('mes_user_id'); } catch (e) {}

  try {
    const cached = localStorage.getItem('mes_catalog_v2');
    if (cached && applyCatalogData(JSON.parse(cached))) {
      if (loginBtn) { loginBtn.disabled = false; loginBtn.innerHTML = 'Войти в систему'; }
      if (savedUserId) {
        const u = state.workers.find(w => String(w.id) === String(savedUserId));
        if (u) enterAppAs(u);
      }
    } else if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.innerHTML = '<span class="spinner"></span> Подключение к базе...';
    }
  } catch (e) {}

  try {
    const res = await Promise.all([
      sbFetch('workshops?is_active=eq.true&order=id'),
      sbFetch('shifts?order=sort_order'),
      sbFetch('workers?is_active=eq.true&order=id'),
      sbFetch('chair_models?is_active=eq.true&order=id'),
      sbFetch('model_variants?order=id'),
      sbFetch('worker_allowed_models')
    ]);
    const fresh = {
      workshops: res || [], shifts: res || [], workers: res || [],
      models: res || [], variants: res || [], allowances: res || []
    };
    if (applyCatalogData(fresh)) {
      try { localStorage.setItem('mes_catalog_v2', JSON.stringify(fresh)); } catch (e) {}
      if (loginBtn) { loginBtn.disabled = false; loginBtn.innerHTML = 'Войти в систему'; }
      if (savedUserId) {
        const u = state.workers.find(w => String(w.id) === String(savedUserId));
        if (u) { if (!state.user) enterAppAs(u); }
        else { doLogout(); }
      }
    }
  } catch (err) {
    if (!state.workers.length) {
      el('loginErr').innerText = 'Нет связи с базой: ' + err.message;
      if (loginBtn) { loginBtn.disabled = false; loginBtn.innerHTML = 'Повторить подключение'; }
    }
  }
}

function doLogin() {
  if (!state.workers.length) { bootstrap(); return; }
  const pin = el('pinInp').value.trim();
  const found = state.workers.find(w => String(w.pin_code) === pin);
  if (!found) { el('loginErr').innerText = 'Неверный PIN-код или доступ закрыт'; return; }
  enterAppAs(found);
}

function doLogout() {
  state.user = null;
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  try { localStorage.removeItem('mes_user_id'); } catch (e) {}
  el('appView').classList.add('hidden');
  el('loginView').classList.remove('hidden');
}
function switchTab(name) {
  if (state.user && state.user.role === 'worker' && name !== 'schedule' && name !== 'report') {
    name = 'schedule';
  }
  ['schedule', 'fg', 'mat', 'report', 'forecast', 'catalog'].forEach(t => {
    el('tab-' + t).classList.toggle('hidden', t !== name);
    const nb = el('nav-' + t);
    if (nb) { nb.className = (t === name) ? 'btn btn-primary' : 'btn btn-dark'; }
  });
  if (name === 'fg') loadFinishedGoods();
  if (name === 'mat') loadMaterialsData();
  if (name === 'report' || name === 'forecast') loadAnalytics();
}

function shiftDate(days) {
  const d = new Date(el('selDate').value);
  d.setDate(d.getDate() + days);
  el('selDate').value = d.toISOString().slice(0, 10);
  loadTasks();
}

async function loadTasks() {
  const d = el('selDate').value;
  const wId = el('selWorkshop').value;
  const sId = el('selShift').value;
  try {
    let url = 'tasks?work_date=eq.' + d + '&workshop_id=eq.' + wId + '&shift_id=eq.' + sId + '&status=eq.active';
    if (state.user && state.user.role === 'worker') {
      url += '&worker_id=eq.' + state.user.id;
    }
    state.tasks = await sbFetch(url) || [];
    renderWorkersGrid();
  } catch (e) { console.error(e); }
}

function renderWorkersGrid() {
  const wId = Number(el('selWorkshop').value);
  let list = state.workers.filter(w => w.role === 'worker' && w.workshop_id === wId);
  if (state.user.role === 'worker') list = list.filter(w => w.id === state.user.id);
  if (!list.length) {
    el('workersGrid').innerHTML = '<div class="card" style="padding:20px;color:#64748b;">Нет назначенных мастеров или заданий на эту смену.</div>';
    return;
  }

  const isAdmin = state.user.role === 'admin';
  const canOtk = isAdmin || state.user.role === 'otk';

  el('workersGrid').innerHTML = list.map(w => {
    const wTasks = state.tasks.filter(t => t.worker_id === w.id);
    const planSum = wTasks.reduce((s, t) => s + t.plan_qty, 0);
    const accSum = wTasks.reduce((s, t) => s + t.accepted_qty, 0);
    const normTxt = w.max_per_day ? ' <span style="color:#1d4ed8;font-weight:700;">(Норма: ' + w.max_per_day + ')</span>' : '';

    let slotsHtml = '';
    for (let slot = 1; slot <= 6; slot++) {
      const t = wTasks.find(x => x.slot_index === slot);
      if (t) {
        const mName = (state.models.find(m => m.id === t.model_id) || {}).name || '—';
        const vName = (state.variants.find(v => v.id === t.variant_id) || {}).variant_name || '—';
        const bg = t.accepted_qty >= t.plan_qty ? '#dcfce7;border-color:#4ade80' : (t.accepted_qty > 0 ? '#fef3c7;border-color:#fbbf24' : '#f8fafc;border-color:#cbd5e1');
        const note = t.carryover_note ? '<span style="background:#fde68a;color:#78350f;padding:1px 6px;border-radius:4px;font-size:11px;margin-left:4px;">' + t.carryover_note + '</span>' : '';
        const otkBtns = canOtk
          ? '<button class="btn btn-sm" onclick="changeAcc(\'' + t.id + '\',' + (t.accepted_qty - 1) + ',' + t.plan_qty + ')">−</button>' +
            '<b style="min-width:24px;text-align:center;color:#15803d;">' + t.accepted_qty + '</b>' +
            '<button class="btn btn-sm" onclick="changeAcc(\'' + t.id + '\',' + (t.accepted_qty + 1) + ',' + t.plan_qty + ')">+</button>' +
            '<button class="btn btn-green" onclick="changeAcc(\'' + t.id + '\',' + t.plan_qty + ',' + t.plan_qty + ')">Всё ✓</button>'
          : '<b style="color:#15803d;">' + t.accepted_qty + ' из ' + t.plan_qty + '</b>';
        const editBtn = isAdmin ? '<button class="btn btn-light" style="padding:3px 8px;font-size:11px;" onclick="openModal(' + w.id + ',' + slot + ',\'' + t.id + '\')">Изменить</button>' : '';

        slotsHtml += '<div style="padding:10px;border:1px solid ' + bg + ';border-radius:8px;margin-bottom:8px;">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;">' +
            '<div><b>' + slot + '. ' + mName + '</b>' + note + '<div style="font-size:12px;color:#475569;">' + vName + '</div></div>' +
            '<span style="background:#fff;border:1px solid #cbd5e1;padding:2px 7px;border-radius:6px;font-size:12px;font-weight:700;height:fit-content;">План: ' + t.plan_qty + ' шт.</span>' +
          '</div>' +
          '<div class="no-print" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.08);display:flex;justify-content:space-between;align-items:center;">' +
            '<div style="display:flex;align-items:center;gap:4px;font-size:12px;"><span>Принято:</span>' + otkBtns + '</div>' + editBtn +
          '</div>' +
        '</div>';
      } else if (isAdmin) {
        slotsHtml += '<button onclick="openModal(' + w.id + ',' + slot + ',null)" class="no-print" style="width:100%;text-align:left;padding:7px 10px;margin-bottom:6px;border:1px dashed #cbd5e1;border-radius:8px;background:transparent;color:#64748b;cursor:pointer;font-size:12px;">+ Слот ' + slot + ' (назначить задание)</button>';
      }
    }

    return '<div class="card" style="overflow:hidden;">' +
      '<div style="padding:12px 14px;border-bottom:1px solid #e2e8f0;background:' + (w.color_hex || '#ebf3fa') + ';">' +
        '<div style="font-weight:700;font-size:15px;">' + w.name + '</div>' +
        '<div style="font-size:12px;color:#334155;">План: <b>' + planSum + '</b> шт. | Принято ОТК: <b style="color:#15803d;">' + accSum + '</b> шт.' + normTxt + '</div>' +
      '</div>' +
      '<div style="padding:12px;">' + slotsHtml + '</div>' +
    '</div>';
  }).join('');
}
async function changeAcc(taskId, nextVal, maxVal) {
  const clamped = Math.max(0, Math.min(maxVal, nextVal));
  const task = state.tasks.find(t => t.id === taskId);
  const prevVal = task ? task.accepted_qty : 0;
  if (task) { task.accepted_qty = clamped; renderWorkersGrid(); }
  try {
    await sbFetch('tasks?id=eq.' + taskId, { method: 'PATCH', body: JSON.stringify({ accepted_qty: clamped }) });
  } catch (err) {
    if (task) { task.accepted_qty = prevVal; renderWorkersGrid(); }
    alert('Ошибка приёмки: ' + err.message);
  }
}

function openModal(workerId, slot, taskId) {
  state.modalWorker = state.workers.find(w => w.id === workerId);
  state.modalSlot = slot;
  state.editingTask = taskId ? state.tasks.find(t => t.id === taskId) : null;
  el('modalErr').innerText = ''; el('fReason').value = '';
  el('modalTitle').innerText = state.editingTask ? ('Редактирование слота #' + slot) : ('Новое задание (Слот #' + slot + ')');
  el('modalSub').innerText = 'Мастер: ' + state.modalWorker.name + ' | Дата: ' + fmtDateRu(el('selDate').value);

  const allowedIds = state.allowances.filter(a => a.worker_id === workerId).map(a => a.model_id);
  const allowedModels = allowedIds.length ? state.models.filter(m => allowedIds.includes(m.id)) : state.models;
  el('fModel').innerHTML = allowedModels.map(m => '<option value="' + m.id + '">' + m.name + '</option>').join('');

  if (state.editingTask) {
    el('fModel').value = state.editingTask.model_id;
    onModalModelChange();
    el('fVariant').value = state.editingTask.variant_id;
    el('fQty').value = state.editingTask.plan_qty;
    el('btnDelTask').classList.remove('hidden');
    const over3h = (Date.now() - new Date(state.editingTask.created_at).getTime()) >= (3 * 60 * 60 * 1000);
    el('reasonBox').classList.toggle('hidden', !over3h);
  } else {
    onModalModelChange();
    el('fQty').value = 1;
    el('btnDelTask').classList.add('hidden');
    el('reasonBox').classList.add('hidden');
  }
  el('taskModal').classList.remove('hidden');
}

function onModalModelChange() {
  const mId = Number(el('fModel').value);
  const vs = state.variants.filter(v => v.model_id === mId);
  el('fVariant').innerHTML = vs.map(v => '<option value="' + v.id + '">' + v.variant_name + '</option>').join('');
}
function closeModal() { el('taskModal').classList.add('hidden'); }

async function saveTask() {
  el('modalErr').innerText = '';
  const mId = Number(el('fModel').value);
  const vId = Number(el('fVariant').value);
  const qty = Number(el('fQty').value);
  const reason = el('fReason').value.trim();

  const limit = state.modalWorker.max_per_day;
  if (limit && limit > 0) {
    const otherSum = state.tasks
      .filter(t => t.worker_id === state.modalWorker.id && (!state.editingTask || t.id !== state.editingTask.id))
      .reduce((s, t) => s + t.plan_qty, 0);
    if (otherSum + qty > limit) {
      el('modalErr').innerText = 'Превышен дневной лимит: макс. ' + limit + ' шт. (уже ' + otherSum + ' шт.)';
      return;
    }
  }

  if (state.editingTask) {
    const target = state.editingTask;
    const backup = Object.assign({}, target);
    target.model_id = mId; target.variant_id = vId; target.plan_qty = qty;
    closeModal(); renderWorkersGrid();
    try {
      await sbFetch('rpc/update_task_with_reason', {
        method: 'POST',
        body: JSON.stringify({
          p_task_id: target.id, p_model_id: mId, p_variant_id: vId,
          p_plan_qty: qty, p_reason: reason, p_editor: state.user.name
        })
      });
    } catch (err) {
      Object.assign(target, backup); renderWorkersGrid();
      alert('Изменение отклонено сервером: ' + err.message);
    }
  } else {
    const tempId = 'temp_' + Date.now();
    const optimisticTask = {
      id: tempId, work_date: el('selDate').value, workshop_id: Number(el('selWorkshop').value),
      shift_id: Number(el('selShift').value), worker_id: state.modalWorker.id,
      slot_index: state.modalSlot, model_id: mId, variant_id: vId,
      plan_qty: qty, accepted_qty: 0, created_at: new Date().toISOString(), created_by: state.user.name
    };
    state.tasks.push(optimisticTask);
    closeModal(); renderWorkersGrid();
    try {
      const inserted = await sbFetch('tasks', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          work_date: optimisticTask.work_date, workshop_id: optimisticTask.workshop_id,
          shift_id: optimisticTask.shift_id, worker_id: optimisticTask.worker_id,
          slot_index: optimisticTask.slot_index, model_id: mId, variant_id: vId,
          plan_qty: qty, created_by: state.user.name
        })
      });
      if (inserted && inserted.length) Object.assign(optimisticTask, inserted.shift());
    } catch (err) {
      state.tasks = state.tasks.filter(t => t.id !== tempId); renderWorkersGrid();
      alert('Ошибка сохранения: ' + err.message);
    }
  }
}

async function deleteTask() {
  const target = state.editingTask;
  const reason = el('fReason').value.trim();
  state.tasks = state.tasks.filter(t => t.id !== target.id);
  closeModal(); renderWorkersGrid();
  try {
    await sbFetch('rpc/delete_task_with_reason', {
      method: 'POST',
      body: JSON.stringify({ p_task_id: target.id, p_reason: reason, p_editor: state.user.name })
    });
  } catch (err) {
    state.tasks.push(target); renderWorkersGrid();
    alert('Удаление отклонено сервером: ' + err.message);
  }
}
function onOrderModelChange() {
  const mId = Number(el('oModel').value);
  const vs = state.variants.filter(v => v.model_id === mId);
  el('oVar').innerHTML = vs.map(v => '<option value="' + v.id + '">' + v.variant_name + '</option>').join('');
}

async function loadFinishedGoods() {
  const [fg, orders] = await Promise.all([
    sbFetch('finished_goods_stock?order=model_id'),
    sbFetch('sales_orders?order=id.desc&limit=200')
  ]);
  state.fgStock = fg || [];
  state.salesOrders = orders || [];

  el('fgStockBody').innerHTML = state.fgStock.map(item => {
    const mName = (state.models.find(m => m.id === item.model_id) || {}).name || '—';
    const vName = (state.variants.find(v => v.id === item.variant_id) || {}).variant_name || '—';
    const free = Math.max(0, item.physical_qty - item.reserved_qty);
    return '<tr><td><b>' + mName + '</b></td><td>' + vName + '</td><td class="tc">' + item.physical_qty + '</td><td class="tc">' + item.reserved_qty + '</td><td class="tc" style="color:#15803d;font-weight:700;">' + free + '</td></tr>';
  }).join('') || '<tr><td colspan="5" class="tc" style="color:#64748b;">На складе готовой продукции пока нет остатков</td></tr>';

  renderOrdersTable();
}

function getFilteredOrders() {
  const fDate = el('fltSoDate').value;
  const fSearch = el('fltSoSearch').value.trim().toLowerCase();
  const fSt = el('fltSoStatus').value;
  return state.salesOrders.filter(o => {
    if (fDate && o.order_date !== fDate) return false;
    if (fSt && o.status !== fSt) return false;
    if (fSearch) {
      const hay = [o.order_number, o.customer_name, o.customer_phone, o.driver_name, o.manager_name, o.city, o.street].join(' ').toLowerCase();
      if (!hay.includes(fSearch)) return false;
    }
    return true;
  });
}

function renderOrdersTable() {
  const list = getFilteredOrders();
  const stMap = {
    reserved: '<span style="color:#d97706;font-weight:700;">В резерве</span>',
    preorder: '<span style="color:#2563eb;font-weight:700;">В произв.</span>',
    shipped: '<span style="color:#15803d;font-weight:700;">Отгружен</span>',
    cancelled: '<span style="color:#94a3b8;">Отменен</span>'
  };

  el('soOrdersBody').innerHTML = list.map(o => {
    const mName = (state.models.find(m => m.id === o.model_id) || {}).name || '—';
    const vName = (state.variants.find(v => v.id === o.variant_id) || {}).variant_name || '—';
    const addr = [o.city, o.street, o.house ? 'д.' + o.house : '', o.apartment ? 'кв.' + o.apartment : ''].filter(Boolean).join(', ');
    const total = (Number(o.unit_price || 0) * Number(o.qty || 1)) + Number(o.delivery_cost || 0);
    const paid = Number(o.pay_cash || 0) + Number(o.pay_card || 0) + Number(o.pay_bank || 0);

    let btns = '<button class="btn btn-light" style="padding:3px 7px;font-size:11px;" onclick="openOrderModal(' + o.id + ')">📄 Карточка</button> ';
    if (o.status === 'preorder') {
      btns += '<button class="btn btn-amber" style="padding:3px 7px;font-size:11px;" onclick="updateSaleStatus(' + o.id + ',\'reserved\')">В резерв</button> ';
    }
    if (o.status === 'reserved' || o.status === 'preorder') {
      btns += '<button class="btn btn-green" style="padding:3px 7px;font-size:11px;" onclick="updateSaleStatus(' + o.id + ',\'shipped\')">Отгрузить</button> ';
      btns += '<button class="btn btn-red" style="padding:3px 7px;font-size:11px;" onclick="updateSaleStatus(' + o.id + ',\'cancelled\')">✕</button>';
    }

    return '<tr>' +
      '<td><b>' + o.order_number + '</b><div style="font-size:11px;color:#64748b;">' + fmtDateRu(o.order_date) + '</div></td>' +
      '<td><b>' + o.customer_name + '</b><div style="font-size:11px;color:#475569;">' + (o.customer_phone || '—') + '</div></td>' +
      '<td><b>' + mName + '</b> (' + vName + ')<div style="font-size:11px;color:#64748b;">' + (o.configuration || 'Стандарт') + '</div></td>' +
      '<td class="tc"><b>' + o.qty + '</b></td>' +
      '<td>' + (addr || 'Самовывоз') + '<div style="font-size:11px;color:#2563eb;">' + (o.delivery_time || '') + '</div></td>' +
      '<td class="tr"><b>' + total + ' ₽</b><div style="font-size:11px;color:#15803d;">Опл: ' + paid + ' ₽</div></td>' +
      '<td><div style="font-size:11px;">М: ' + (o.manager_name || '—') + '</div><div style="font-size:11px;font-weight:600;">В: ' + (o.driver_name || '—') + '</div></td>' +
      '<td class="tc">' + (stMap[o.status] || o.status) + '</td>' +
      '<td class="tc no-print" style="white-space:nowrap;">' + btns + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="9" class="tc" style="color:#64748b;">Заказы не найдены</td></tr>';
}
function openOrderModal(orderId) {
  state.editingOrderId = orderId;
  el('omErr').innerText = '';
  const o = orderId ? state.salesOrders.find(x => x.id === orderId) : null;
  el('omTitle').innerText = o ? ('Карточка заказа № ' + o.order_number) : 'Новый заказ на производство / доставку';

  el('oNum').value = o ? o.order_number : ('ЗК-' + Math.floor(100 + Math.random() * 900));
  el('oDate').value = o && o.order_date ? o.order_date : new Date().toISOString().slice(0, 10);
  el('oMgr').value = o ? (o.manager_name || '') : (state.user ? state.user.name : '');
  el('oDrv').value = o ? (o.driver_name || '') : '';
  el('oSrc').value = o ? (o.lead_source || '') : '';
  el('oCust').value = o ? (o.customer_name || '') : '';
  el('oPhone').value = o ? (o.customer_phone || '') : '';

  if (o && o.model_id) el('oModel').value = o.model_id;
  onOrderModelChange();
  if (o && o.variant_id) el('oVar').value = o.variant_id;

  el('oCfg').value = o ? (o.configuration || 'Стандарт') : 'Стандарт';
  el('oQty').value = o ? o.qty : 1;
  el('oPrice').value = o ? (o.unit_price || 0) : 0;
  el('oDeliv').value = o ? (o.delivery_cost || 0) : 0;
  el('oCity').value = o ? (o.city || '') : '';
  el('oStreet').value = o ? (o.street || '') : '';
  el('oHouse').value = o ? (o.house || '') : '';
  el('oBldg').value = o ? (o.building || '') : '';
  el('oEntr').value = o ? (o.entrance || '') : '';
  el('oFloor').value = o ? (o.floor || '') : '';
  el('oApt').value = o ? (o.apartment || '') : '';
  el('oTime').value = o ? (o.delivery_time || '') : '';
  el('oComm').value = o ? (o.comment || '') : '';
  el('oCash').value = o ? (o.pay_cash || 0) : 0;
  el('oCard').value = o ? (o.pay_card || 0) : 0;
  el('oBank').value = o ? (o.pay_bank || 0) : 0;
  el('oHanded').value = o ? (o.cash_handed || 0) : 0;
  el('oExp').value = o ? (o.cash_expenses || 0) : 0;

  recalcOrderTotal();
  el('orderModal').classList.remove('hidden');
}

function closeOrderModal() { el('orderModal').classList.add('hidden'); }

function recalcOrderTotal() {
  const qty = Number(el('oQty').value) || 0;
  const price = Number(el('oPrice').value) || 0;
  const deliv = Number(el('oDeliv').value) || 0;
  const total = qty * price + deliv;

  const cash = Number(el('oCash').value) || 0;
  const card = Number(el('oCard').value) || 0;
  const bank = Number(el('oBank').value) || 0;
  const paid = cash + card + bank;
  const debt = total - paid;

  const handed = Number(el('oHanded').value) || 0;
  const exp = Number(el('oExp').value) || 0;
  const driverCashLeft = cash - handed - exp;

  el('oSummaryBox').innerHTML =
    '<div>Итого заказ: <b>' + total + ' ₽</b></div>' +
    '<div>Оплачено: <b style="color:#15803d;">' + paid + ' ₽</b></div>' +
    '<div>Долг клиента: <b style="color:' + (debt > 0 ? '#dc2626' : '#15803d') + ';">' + debt + ' ₽</b></div>' +
    '<div>Наличных на руках (после сдачи и расходов): <b>' + driverCashLeft + ' ₽</b></div>';
}

async function saveOrderModal() {
  el('omErr').innerText = '';
  const payload = {
    order_number: el('oNum').value.trim() || ('ЗК-' + Math.floor(100 + Math.random() * 900)),
    order_date: el('oDate').value || new Date().toISOString().slice(0, 10),
    manager_name: el('oMgr').value.trim(),
    driver_name: el('oDrv').value.trim(),
    lead_source: el('oSrc').value.trim(),
    customer_name: el('oCust').value.trim() || 'Покупатель',
    customer_phone: el('oPhone').value.trim(),
    model_id: Number(el('oModel').value),
    variant_id: Number(el('oVar').value),
    configuration: el('oCfg').value.trim() || 'Стандарт',
    qty: Number(el('oQty').value) || 1,
    unit_price: Number(el('oPrice').value) || 0,
    delivery_cost: Number(el('oDeliv').value) || 0,
    city: el('oCity').value.trim(),
    street: el('oStreet').value.trim(),
    house: el('oHouse').value.trim(),
    building: el('oBldg').value.trim(),
    entrance: el('oEntr').value.trim(),
    floor: el('oFloor').value.trim(),
    apartment: el('oApt').value.trim(),
    delivery_time: el('oTime').value.trim(),
    comment: el('oComm').value.trim(),
    pay_cash: Number(el('oCash').value) || 0,
    pay_card: Number(el('oCard').value) || 0,
    pay_bank: Number(el('oBank').value) || 0,
    cash_handed: Number(el('oHanded').value) || 0,
    cash_expenses: Number(el('oExp').value) || 0
  };

  try {
    if (state.editingOrderId) {
      await sbFetch('sales_orders?id=eq.' + state.editingOrderId, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      payload.status = 'reserved';
      payload.created_by = state.user ? state.user.name : '';
      await sbFetch('sales_orders', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeOrderModal();
    loadFinishedGoods();
  } catch (err) { el('omErr').innerText = err.message; }
}

async function updateSaleStatus(orderId, newStatus) {
  try {
    await sbFetch('sales_orders?id=eq.' + orderId, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    loadFinishedGoods();
  } catch (err) { alert(err.message); }
}

function exportOrdersCsv() {
  const rows = getFilteredOrders();
  const head = ['№','Дата','Менеджер','Водитель','Клиент','Номер телефона','Название кресла','Цвет','Комплектация','шт','Цена','Доставка','Источник обращения','Город доставки','Улица','№ дома','Корпус','Подъезд','Этаж','Квартира','Время','Комментарий','Наличные','Карта','На счёт','Сдано наличных','Расходы наличка'];
  const csvLines = [head.join(';')];
  rows.forEach(o => {
    const mName = (state.models.find(m => m.id === o.model_id) || {}).name || '';
    const vName = (state.variants.find(v => v.id === o.variant_id) || {}).variant_name || '';
    const vals = [o.order_number, o.order_date, o.manager_name, o.driver_name, o.customer_name, o.customer_phone, mName, vName, o.configuration, o.qty, o.unit_price, o.delivery_cost, o.lead_source, o.city, o.street, o.house, o.building, o.entrance, o.floor, o.apartment, o.delivery_time, o.comment, o.pay_cash, o.pay_card, o.pay_bank, o.cash_handed, o.cash_expenses];
    csvLines.push(vals.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(';'));
  });
  const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'roskresla_orders_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}
function onBomModelChange() {
  const mId = Number(el('bomModel').value);
  const vs = state.variants.filter(v => v.model_id === mId);
  el('bomVar').innerHTML = '<option value="">Все цвета модели (общая деталь)</option>' +
    vs.map(v => '<option value="' + v.id + '">' + v.variant_name + '</option>').join('');
}

async function loadMaterialsData() {
  const [mats, boms] = await Promise.all([
    sbFetch('materials?is_active=eq.true&order=category,name'),
    sbFetch('product_bom?order=id.desc')
  ]);
  state.materials = mats || [];
  state.bom = boms || [];

  const matOpts = state.materials.map(m => '<option value="' + m.id + '">' + m.name + ' (' + m.unit + ')</option>').join('');
  el('inMatSel').innerHTML = matOpts;
  el('bomMat').innerHTML = matOpts;

  el('matStockBody').innerHTML = state.materials.map(m => {
    const low = Number(m.stock_qty) <= Number(m.min_stock);
    const st = low ? '<span style="color:#dc2626;font-weight:700;">⚠️ Мало</span>' : '<span style="color:#15803d;font-weight:700;">Норма</span>';
    return '<tr style="' + (low ? 'background:#fef2f2;' : '') + '"><td>' + m.category + '</td><td><b>' + m.name + '</b></td><td class="tc"><b>' + m.stock_qty + ' ' + m.unit + '</b></td><td class="tc">' + m.min_stock + ' ' + m.unit + '</td><td class="tc">' + st + '</td></tr>';
  }).join('') || '<tr><td colspan="5" class="tc" style="color:#64748b;">Добавьте первый материал сверху</td></tr>';

  el('bomBody').innerHTML = state.bom.map(b => {
    const mName = (state.models.find(m => m.id === b.model_id) || {}).name || '—';
    const vName = b.variant_id ? ((state.variants.find(v => v.id === b.variant_id) || {}).variant_name || '') : 'Все варианты';
    const mat = state.materials.find(x => x.id === b.material_id) || { name: '—', unit: '' };
    return '<tr><td><b>' + mName + '</b><br><span style="font-size:11px;color:#64748b;">' + vName + '</span></td><td>' + mat.name + '</td><td class="tc"><b>' + b.qty_per_unit + ' ' + mat.unit + '</b></td><td class="tc"><button class="btn btn-red" style="padding:2px 6px;font-size:11px;" onclick="delBomItem(' + b.id + ')">✕</button></td></tr>';
  }).join('');
}

async function addMaterial() {
  const name = el('mName').value.trim();
  if (!name) return;
  await sbFetch('materials', {
    method: 'POST',
    body: JSON.stringify({
      name: name, category: el('mCat').value, unit: el('mUnit').value,
      stock_qty: Number(el('mInitQty').value) || 0, min_stock: Number(el('mMinQty').value) || 0
    })
  });
  el('mName').value = ''; el('mInitQty').value = ''; el('mMinQty').value = '';
  loadMaterialsData();
}

async function receiveMaterial() {
  const mId = Number(el('inMatSel').value);
  const addQty = Number(el('inMatQty').value);
  if (!mId || addQty <= 0) return;
  const cur = state.materials.find(m => m.id === mId);
  const nextQty = (Number(cur.stock_qty) || 0) + addQty;
  await sbFetch('materials?id=eq.' + mId, { method: 'PATCH', body: JSON.stringify({ stock_qty: nextQty }) });
  await sbFetch('material_movements', {
    method: 'POST',
    body: JSON.stringify({ material_id: mId, move_type: 'in', qty: addQty, reference_info: 'Приход на склад', created_by: state.user.name })
  });
  el('inMatQty').value = '';
  loadMaterialsData();
}

async function addBomItem() {
  const qty = Number(el('bomQty').value);
  if (qty <= 0) return;
  const vRaw = el('bomVar').value;
  await sbFetch('product_bom', {
    method: 'POST',
    body: JSON.stringify({
      model_id: Number(el('bomModel').value),
      variant_id: vRaw ? Number(vRaw) : null,
      material_id: Number(el('bomMat').value),
      qty_per_unit: qty
    })
  });
  el('bomQty').value = '';
  loadMaterialsData();
}

async function delBomItem(id) {
  await sbFetch('product_bom?id=eq.' + id, { method: 'DELETE' });
  loadMaterialsData();
}
async function runRollover() {
  try {
    const moved = await sbFetch('rpc/rollover_unaccepted_tasks', { method: 'POST', body: JSON.stringify({ p_src_date: el('selDate').value }) });
    alert('Перенесено невыполненных кресел на завтра: ' + (moved || 0) + ' шт.');
    loadTasks();
  } catch (err) { alert(err.message); }
}

async function addVariant() {
  const name = el('newVarInp').value.trim();
  if (!name) return;
  await sbFetch('model_variants', { method: 'POST', body: JSON.stringify({ model_id: Number(el('catModelSel').value), variant_name: name }) });
  state.variants = await sbFetch('model_variants?order=id') || [];
  try { localStorage.removeItem('mes_catalog_v2'); } catch (e) {}
  el('newVarInp').value = '';
  onOrderModelChange(); onBomModelChange();
  alert('Вариант обивки добавлен!');
}

async function addWorker() {
  const name = el('nwName').value.trim();
  const pin = el('nwPin').value.trim();
  if (!name || !/^\d{4}$/.test(pin)) { alert('Укажите имя и ровно 4 цифры PIN-кода.'); return; }
  if (state.workers.some(w => String(w.pin_code) === pin)) { alert('Этот PIN-код уже занят другим сотрудником!'); return; }
  const lim = Number(el('nwLimit').value);
  await sbFetch('workers', {
    method: 'POST',
    body: JSON.stringify({
      name: name, pin_code: pin, workshop_id: Number(el('nwWorkshop').value),
      default_shift_id: 1, role: el('nwRole').value, max_per_day: lim > 0 ? lim : null
    })
  });
  state.workers = await sbFetch('workers?is_active=eq.true&order=id') || [];
  try { localStorage.removeItem('mes_catalog_v2'); } catch (e) {}
  el('nwName').value = ''; el('nwPin').value = ''; el('nwLimit').value = '';
  renderCatalogWorkers();
  alert('Сотрудник добавлен!');
}

async function dismissWorker(workerId) {
  const w = state.workers.find(x => x.id === workerId);
  if (!w) return;
  if (state.user && w.id === state.user.id) { alert('Нельзя уволить самого себя!'); return; }
  if (!confirm('Уволить сотрудника «' + w.name + '»? Он исчезнет из графиков смен и потеряет доступ по PIN, но его прошлые отчёты сохранятся.')) return;
  try {
    await sbFetch('workers?id=eq.' + workerId, { method: 'PATCH', body: JSON.stringify({ is_active: false }) });
    state.workers = state.workers.filter(x => x.id !== workerId);
    try { localStorage.removeItem('mes_catalog_v2'); } catch (e) {}
    renderCatalogWorkers();
    alert('Сотрудник «' + w.name + '» уволен и переведён в архив.');
  } catch (err) { alert('Ошибка увольнения: ' + err.message); }
}

async function changeWorkerPin(workerId) {
  const w = state.workers.find(x => x.id === workerId);
  if (!w) return;
  const newPin = prompt('Введите новый 4-значный PIN-код для сотрудника «' + w.name + '»:', w.pin_code);
  if (newPin === null) return;
  const clean = String(newPin).trim();
  if (!/^\d{4}$/.test(clean)) { alert('Ошибка: PIN-код должен состоять ровно из 4 цифр.'); return; }
  if (state.workers.some(x => x.id !== workerId && String(x.pin_code) === clean)) {
    alert('Этот PIN-код уже используется другим сотрудником!');
    return;
  }
  try {
    await sbFetch('workers?id=eq.' + workerId, { method: 'PATCH', body: JSON.stringify({ pin_code: clean }) });
    w.pin_code = clean;
    try { localStorage.removeItem('mes_catalog_v2'); } catch (e) {}
    renderCatalogWorkers();
    alert('Новый PIN-код для «' + w.name + '» успешно сохранен!');
  } catch (err) { alert('Ошибка смены PIN: ' + err.message); }
}

function renderCatalogWorkers() {
  el('catWorkersBody').innerHTML = state.workers.map(w => {
    const wsName = (state.workshops.find(x => x.id === w.workshop_id) || {}).name || '—';
    const disBtn = (state.user && w.id === state.user.id) ? '' : ' <button class="btn btn-red" style="padding:3px 8px;font-size:11px;" onclick="dismissWorker(' + w.id + ')">🚫 Уволить</button>';
    return '<tr><td><b>' + w.name + '</b></td><td>' + wsName + '</td><td><code>' + w.pin_code + '</code></td><td class="tc"><b>' + (w.max_per_day || '—') + '</b></td><td class="tc" style="white-space:nowrap;"><button class="btn btn-light" style="padding:3px 8px;font-size:11px;" onclick="changeWorkerPin(' + w.id + ')">🔑 PIN</button>' + disBtn + '</td></tr>';
  }).join('');
}

async function loadAnalytics() {
  const mStr = el('repMonth').value;
  const isWorker = state.user && state.user.role === 'worker';
  let url = 'tasks?work_date=gte.' + mStr + '-01&work_date=lte.' + mStr + '-31&status=eq.active';
  if (isWorker) url += '&worker_id=eq.' + state.user.id;
  const mTasks = await sbFetch(url) || [];

  const visibleWorkers = isWorker
    ? state.workers.filter(w => w.id === state.user.id)
    : state.workers.filter(w => w.role === 'worker');

  el('repWorkersBody').innerHTML = visibleWorkers.map(w => {
    const wt = mTasks.filter(t => t.worker_id === w.id);
    const p = wt.reduce((s, t) => s + t.plan_qty, 0);
    const a = wt.reduce((s, t) => s + t.accepted_qty, 0);
    return '<tr><td><b>' + w.name + '</b></td><td class="tc"><b>' + p + '</b></td><td class="tc" style="color:#15803d;"><b>' + a + '</b></td></tr>';
  }).join('');

  const abcCard = el('repAbcBody') ? el('repAbcBody').closest('.card') : null;
  if (abcCard) abcCard.classList.toggle('hidden', isWorker);
  if (isWorker) return;

  const abcMap = {}; let totAcc = 0;
  mTasks.forEach(t => {
    const k = t.model_id + '_' + t.variant_id;
    if (!abcMap[k]) abcMap[k] = {
      model: (state.models.find(m => m.id === t.model_id) || {}).name || '—',
      mat: (state.variants.find(v => v.id === t.variant_id) || {}).variant_name || '—',
      plan: 0, acc: 0
    };
    abcMap[k].plan += t.plan_qty; abcMap[k].acc += t.accepted_qty; totAcc += t.accepted_qty;
  });
  const sortedAbc = Object.values(abcMap).sort((a, b) => (b.acc - a.acc) || (b.plan - a.plan));
  const basis = totAcc > 0 ? totAcc : sortedAbc.reduce((s, x) => s + x.plan, 0);
  let cum = 0;
  el('repAbcBody').innerHTML = sortedAbc.map(it => {
    const v = totAcc > 0 ? it.acc : it.plan;
    const share = basis > 0 ? v / basis : 0;
    const prev = cum; cum += share;
    const grp = v === 0 ? 'C' : (prev < 0.80 ? 'A' : (prev < 0.95 ? 'B' : 'C'));
    const rowBg = grp === 'A' ? '#dcfce7' : (grp === 'B' ? '#fef9c3' : '#fff');
    return '<tr style="background:' + rowBg + ';"><td><b>' + it.model + '</b></td><td>' + it.mat + '</td><td class="tc">' + it.plan + '</td><td class="tc" style="color:#15803d;"><b>' + it.acc + '</b></td><td class="tc">' + (share * 100).toFixed(1) + '%</td><td class="tc"><b>' + grp + '</b></td></tr>';
  }).join('');

  const today = new Date();
  const d28 = new Date(today); d28.setDate(today.getDate() - 28);
  const d6 = new Date(today); d6.setDate(today.getDate() + 6);
  const fTasks = await sbFetch('tasks?work_date=gte.' + d28.toISOString().slice(0, 10) + '&work_date=lte.' + d6.toISOString().slice(0, 10) + '&status=eq.active') || [];
  const fMap = {};
  const todayIso = today.toISOString().slice(0, 10);
  const d7Iso = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);

  fTasks.forEach(t => {
    const k = t.model_id + '_' + t.variant_id;
    if (!fMap[k]) fMap[k] = {
      model: (state.models.find(m => m.id === t.model_id) || {}).name || '—',
      mat: (state.variants.find(v => v.id === t.variant_id) || {}).variant_name || '—',
      w1: 0, w24: 0, nextPlan: 0
    };
    if (t.work_date >= todayIso) fMap[k].nextPlan += t.plan_qty;
    else if (t.work_date >= d7Iso) fMap[k].w1 += (t.accepted_qty || t.plan_qty);
    else fMap[k].w24 += (t.accepted_qty || t.plan_qty);
  });

  el('fcBody').innerHTML = Object.values(fMap).map(it => {
    const avg3 = it.w24 / 3;
    const fc = Math.ceil(avg3 > 0 ? (0.5 * it.w1 + 0.5 * avg3) : it.w1);
    const trend = avg3 === 0 && it.w1 > 0 ? '🆕 Новый' : (it.w1 > avg3 * 1.15 ? '↗ Рост' : (it.w1 < avg3 * 0.85 ? '↘ Спад' : '→ Стаб.'));
    return { model: it.model, mat: it.mat, w1: it.w1, avg3: avg3.toFixed(1), trend: trend, fc: fc, next: it.nextPlan, toPlan: Math.max(0, fc - it.nextPlan) };
  }).sort((a, b) => b.fc - a.fc).map(r =>
    '<tr><td><b>' + r.model + '</b></td><td>' + r.mat + '</td><td class="tc">' + r.w1 + '</td><td class="tc">' + r.avg3 + '</td><td class="tc">' + r.trend + '</td><td class="tc" style="background:#dbeafe;font-weight:700;">' + r.fc + '</td><td class="tc">' + r.next + '</td><td class="tc" style="color:#b91c1c;font-weight:700;">' + r.toPlan + '</td></tr>'
  ).join('');
}

window.addEventListener('DOMContentLoaded', bootstrap);
