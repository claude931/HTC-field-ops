/* ============================================================
   HTC FIELD OPS — app.js
   Full application logic with Supabase backend
   ============================================================ */

// ============================================================
// CONFIG — Replace with your Supabase project values
// ============================================================
const SUPABASE_URL = 'https://fjuxclckfozjxlghrwss.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqdXhjbGNrZm96anhsZ2hyd3NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTAzODUsImV4cCI6MjA5NDg4NjM4NX0.RxSYy-V48Bgu_EQLGgIK4IELIxiDOrQ0PfVrDTcZeeU';

// ============================================================
// SUPABASE CLIENT
// ============================================================
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 5 } }
});

// ============================================================
// OFFLINE QUEUE (sync when reconnected)
// ============================================================
const OfflineQueue = {
  _key: 'htc_offline_queue',
  get() { try { return JSON.parse(localStorage.getItem(this._key) || '[]'); } catch { return []; } },
  add(op) {
    const q = this.get();
    q.push({ ...op, id: Date.now(), ts: new Date().toISOString() });
    localStorage.setItem(this._key, JSON.stringify(q));
    UI.showOfflineBanner(true);
  },
  clear() { localStorage.removeItem(this._key); UI.showOfflineBanner(false); },
  async flush() {
    const q = this.get();
    if (!q.length) return;
    const failed = [];
    for (const op of q) {
      try {
        if (op.type === 'insert') await sb.from(op.table).insert(op.data);
        if (op.type === 'update') await sb.from(op.table).update(op.data).eq('id', op.id_val);
      } catch { failed.push(op); }
    }
    if (failed.length) {
      localStorage.setItem(this._key, JSON.stringify(failed));
    } else {
      this.clear();
      UI.toast('Offline data synced successfully', 'success');
    }
  }
};

// ============================================================
// SAFE DB WRAPPER (auto-retry, error handling, offline queue)
// ============================================================
const DB = {
  async select(table, query = {}) {
    let req = sb.from(table).select(query.select || '*');
    if (query.eq) Object.entries(query.eq).forEach(([k, v]) => req = req.eq(k, v));
    if (query.order) req = req.order(query.order, { ascending: query.asc ?? true });
    if (query.limit) req = req.limit(query.limit);
    if (query.gte) Object.entries(query.gte).forEach(([k, v]) => req = req.gte(k, v));
    if (query.lte) Object.entries(query.lte).forEach(([k, v]) => req = req.lte(k, v));
    if (query.in) req = req.in(query.in[0], query.in[1]);
    const { data, error } = await req;
    if (error) throw error;
    return data;
  },

  async insert(table, data, queueIfOffline = true) {
    try {
      const { data: result, error } = await sb.from(table).insert(data).select();
      if (error) throw error;
      return result;
    } catch (e) {
      if (!navigator.onLine && queueIfOffline) {
        OfflineQueue.add({ type: 'insert', table, data });
        UI.toast('Saved offline — will sync when connected', 'warning');
        return null;
      }
      throw e;
    }
  },

  async update(table, id, data) {
    try {
      const { data: result, error } = await sb.from(table).update(data).eq('id', id).select();
      if (error) throw error;
      return result;
    } catch (e) {
      if (!navigator.onLine) {
        OfflineQueue.add({ type: 'update', table, data, id_val: id });
        UI.toast('Saved offline — will sync when connected', 'warning');
        return null;
      }
      throw e;
    }
  },

  async rpc(fn, params = {}) {
    const { data, error } = await sb.rpc(fn, params);
    if (error) throw error;
    return data;
  }
};

// ============================================================
// UI HELPERS
// ============================================================
const UI = {
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(`screen-${id}`);
    if (el) el.classList.add('active');
  },

  toast(msg, type = 'info', duration = 3500) {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    const icons = { success: 'ti-check', error: 'ti-alert-circle', warning: 'ti-alert-triangle', info: 'ti-info-circle' };
    t.className = `toast ${type}`;
    t.innerHTML = `<i class="ti ${icons[type] || 'ti-info-circle'}"></i>${msg}`;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, duration);
  },

  openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('open'); },
  closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); },

  showOfflineBanner(show) {
    document.getElementById('offline-banner').style.display = show ? 'flex' : 'none';
  },

  setSyncDot(state) { // 'ok' | 'syncing' | 'error'
    const d = document.getElementById('sync-dot');
    d.className = 'status-dot' + (state !== 'ok' ? ' ' + state : '');
    d.title = state === 'ok' ? 'Synced' : state === 'syncing' ? 'Syncing...' : 'Sync error';
  },

  formatTime(dt) {
    const d = new Date(dt);
    let h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12; if (h === 0) h = 12;
    return `${h}:${m.toString().padStart(2,'0')} ${ap}`;
  },

  formatDate(dt) {
    const d = new Date(dt);
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${days[d.getDay()]}, ${mons[d.getMonth()]} ${d.getDate()}`;
  },

  weekStart(d = new Date()) {
    const dt = new Date(d);
    const day = dt.getDay();
    const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
    dt.setDate(diff); dt.setHours(0,0,0,0);
    return dt;
  },

  weekLabel(start) {
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${mons[start.getMonth()]} ${start.getDate()} – ${end.getDate()}`;
  },

  badgeHtml(status) {
    const map = {
      in_progress: ['badge-amber','In progress'],
      submitted:   ['badge-blue','Submitted'],
      approved:    ['badge-green','Approved'],
      rejected:    ['badge-red','Rejected'],
      absent:      ['badge-red','Absent'],
      active:      ['badge-green','Active'],
      awarded:     ['badge-blue','Awarded'],
      bidding:     ['badge-gray','Bidding'],
      punch_list:  ['badge-amber','Punch list'],
      completed:   ['badge-gray','Completed'],
    };
    const [cls, label] = map[status] || ['badge-gray', status];
    return `<span class="badge ${cls}">${label}</span>`;
  },

  categoryIcon(cat) {
    const icons = {
      'Air': 'ti-wind', 'Guns & Drills': 'ti-bolt', 'Saws & Cutting': 'ti-cut',
      'Measuring & Layout': 'ti-ruler', 'Fastening': 'ti-tool',
      'Lifting & Material Handling': 'ti-forklift', 'Safety': 'ti-shield',
      'Electrical': 'ti-bulb', 'Plumbing': 'ti-droplet', 'Misc': 'ti-box',
    };
    return icons[cat] || 'ti-tool';
  }
};

// ============================================================
// GEO LOCATION
// ============================================================
const Geo = {
  _watchId: null,
  _lastPos: null,
  _pingInterval: null,
  _timeEntryId: null,

  async getPos() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) { rej(new Error('Geolocation not supported')); return; }
      navigator.geolocation.getCurrentPosition(
        p => { this._lastPos = p; res(p); },
        e => { console.warn('Geo error:', e); rej(e); },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });
  },

  startTracking(timeEntryId) {
    this._timeEntryId = timeEntryId;
    // Ping every 15 minutes
    this._pingInterval = setInterval(() => this._ping(), 15 * 60 * 1000);
    // Also watch for significant movement
    if (navigator.geolocation) {
      this._watchId = navigator.geolocation.watchPosition(
        p => { this._lastPos = p; },
        e => console.warn('Watch error:', e),
        { enableHighAccuracy: false, maximumAge: 60000 }
      );
    }
  },

  stopTracking() {
    if (this._watchId) { navigator.geolocation.clearWatch(this._watchId); this._watchId = null; }
    if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
    this._timeEntryId = null;
  },

  async _ping() {
    if (!this._timeEntryId) return;
    try {
      const p = await this.getPos();
      await DB.insert('location_pings', {
        time_entry_id: this._timeEntryId,
        employee_id: State.user.id,
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy_meters: Math.round(p.coords.accuracy)
      });
    } catch { /* silent fail for background pings */ }
  }
};

// ============================================================
// STATE
// ============================================================
const State = {
  user: null,
  profile: null,
  jobs: [],
  tools: [],
  categories: [],
  activeTimeEntry: null,
  adminWeek: null,
  currentTimecardId: null,
  kioskUser: null,
  kioskTimeEntry: null,
  _clockInterval: null,
  _durationInterval: null,
};

// ============================================================
// MAIN APP OBJECT
// ============================================================
const App = {

  // ==================== INIT ====================
  async init() {
    // Clock display
    this._runClock();

    // Network detection
    window.addEventListener('online', () => {
      UI.showOfflineBanner(false);
      OfflineQueue.flush();
      UI.setSyncDot('ok');
    });
    window.addEventListener('offline', () => UI.showOfflineBanner(true));

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
    });

    // Close user menu on outside click
    document.addEventListener('click', e => {
      const menu = document.getElementById('user-menu');
      const avatar = document.getElementById('header-avatar');
      if (menu && !menu.contains(e.target) && e.target !== avatar) menu.style.display = 'none';
    });

    // Check existing session
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await this._onLoggedIn(session.user);
    } else {
      UI.showScreen('login');
    }

    // Listen for auth changes
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) await this._onLoggedIn(session.user);
      if (event === 'SIGNED_OUT') { State.user = null; UI.showScreen('login'); }
    });
  },

  async login() {
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('login-btn');

    errEl.textContent = '';
    if (!email || !pass) { errEl.textContent = 'Please enter email and password.'; return; }

    btn.textContent = 'Signing in...';
    btn.disabled = true;

    try {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    } catch (e) {
      errEl.textContent = e.message || 'Login failed. Please try again.';
      btn.textContent = 'Sign in'; btn.disabled = false;
    }
  },

  async logout() {
    Geo.stopTracking();
    await sb.auth.signOut();
    UI.showScreen('login');
    document.getElementById('user-menu').style.display = 'none';
  },

  async _onLoggedIn(user) {
    State.user = user;
    UI.setSyncDot('syncing');

    // Load profile with auto-troubleshoot
    try {
      const profiles = await DB.select('profiles', { eq: { id: user.id } });
      if (!profiles.length) throw new Error('Profile not found');
      State.profile = profiles[0];
    } catch (e) {
      // Auto-troubleshoot: create profile if missing
      console.warn('Profile missing, attempting auto-create:', e);
      await this._autoCreateProfile(user);
    }

    await this._loadMasterData();
    this._setupUI();
    UI.showScreen('app');
    UI.setSyncDot('ok');

    // Load each tab's data
    await this.tools.load();
    await this.time.load();
    if (State.profile?.role !== 'field') await this.admin.load();

    // Check for active clock-in (resume if browser was closed)
    await this.time.checkActiveEntry();
  },

  async _autoCreateProfile(user) {
    const nameParts = (user.email || '').split('@')[0].split('.');
    const first = nameParts[0] || 'New';
    const last = nameParts[1] || 'User';
    try {
      await DB.insert('profiles', {
        id: user.id,
        first_name: first.charAt(0).toUpperCase() + first.slice(1),
        last_name: last.charAt(0).toUpperCase() + last.slice(1),
        role: 'field',
        email: user.email
      });
      const p = await DB.select('profiles', { eq: { id: user.id } });
      State.profile = p[0];
      UI.toast('Profile created — please update your details in Settings', 'info', 5000);
    } catch (e) {
      console.error('Profile auto-create failed:', e);
      UI.toast('Error loading profile. Please contact your admin.', 'error');
    }
  },

  async _loadMasterData() {
    try {
      [State.jobs, State.categories] = await Promise.all([
        DB.select('jobs', { order: 'name' }),
        DB.select('tool_categories', { order: 'sort_order' }),
      ]);
    } catch (e) {
      console.error('Master data load error:', e);
      UI.toast('Some data failed to load. Check your connection.', 'warning');
    }
  },

  _setupUI() {
    const p = State.profile;
    if (!p) return;
    const isAdmin = ['admin','foreman','project_manager','office'].includes(p.role);

    document.getElementById('header-name').textContent = `${p.first_name} ${p.last_name}`;
    document.getElementById('header-role').textContent = p.role.replace('_',' ');
    document.getElementById('header-avatar').textContent = p.initials;

    // Show admin tab only for admins
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? 'flex' : 'none');
    document.getElementById('tools-add-btn').style.display = isAdmin ? 'flex' : 'none';
    document.getElementById('NB_ADMIN') && (document.getElementById('NB_ADMIN').style.display = isAdmin ? 'flex' : 'none');
    document.getElementById('um-admin').style.display = isAdmin ? 'block' : 'none';

    // Populate job selects
    const jobOpts = State.jobs
      .filter(j => j.status !== 'completed' && j.name !== 'Shop / Warehouse')
      .map(j => `<option value="${j.id}">${j.name}</option>`)
      .join('');
    document.getElementById('clockin-job-select').innerHTML = `<option value="">Select job site...</option>${jobOpts}`;

    // Populate site select for tools
    const siteOpts = State.jobs.map(j => `<option value="${j.id}">${j.name}</option>`).join('');
    document.getElementById('my-site-select').innerHTML = `<option value="">Select site...</option>${siteOpts}`;

    // Category options for tool modal
    document.getElementById('tool-category').innerHTML =
      State.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    State.adminWeek = UI.weekStart();
  },

  _runClock() {
    const update = () => {
      const now = new Date();
      document.getElementById('clock-display').textContent = UI.formatTime(now);
      document.getElementById('kiosk-clock-display').textContent = UI.formatTime(now);
      const dateStr = UI.formatDate(now);
      document.getElementById('clock-date-display').textContent = dateStr;
      document.getElementById('kiosk-clock-date').textContent = dateStr;
    };
    update();
    setInterval(update, 10000);
  },

  gotoTab(name) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${name}`)?.classList.add('active');
    document.querySelector(`.nav-btn[data-tab="${name}"]`)?.classList.add('active');
    document.getElementById('user-menu').style.display = 'none';
  },

  showScreen(name) { UI.showScreen(name); },
  closeModal(id) { UI.closeModal(id); },

  toggleUserMenu() {
    const m = document.getElementById('user-menu');
    m.style.display = m.style.display === 'none' ? 'block' : 'none';
  },

  // ==================== TOOLS MODULE ====================
  tools: {
    _transferToolId: null,

    async load() {
      try {
        State.tools = await DB.select('tools', { select: '*, tool_categories(name)', order: 'name' });
        await this.loadStats();
        await this.loadAllSites();
      } catch (e) {
        console.error('Tools load error:', e);
        UI.toast('Failed to load tool data', 'error');
      }
    },

    async loadStats() {
      try {
        const av = await DB.select('tool_availability');
        const total = av.reduce((s, t) => s + (t.total_owned || 0), 0);
        const deployed = av.reduce((s, t) => s + (t.qty_deployed || 0), 0);
        const shortages = av.filter(t => t.is_shortage).length;
        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-deployed').textContent = deployed;
        document.getElementById('stat-shortage').textContent = shortages;
        document.getElementById('stat-sites').textContent = State.jobs.filter(j => j.status === 'active' && j.name !== 'Shop / Warehouse').length;
      } catch(e) { console.warn('Stats error:', e); }
    },

    async loadSiteTools() {
      const jobId = document.getElementById('my-site-select').value;
      const list = document.getElementById('site-tools-list');
      if (!jobId) { list.innerHTML = ''; return; }

      try {
        const locs = await DB.select('tool_locations', {
          select: 'quantity, tools(id, name, size_type, tool_categories(name))',
          eq: { job_id: jobId }
        });

        if (!locs.length) {
          list.innerHTML = '<div class="empty-state"><i class="ti ti-tool"></i><p>No tools assigned to this site</p></div>';
          return;
        }

        list.innerHTML = locs
          .filter(l => l.quantity > 0)
          .map(l => `
            <div class="tool-card">
              <div class="tool-card-row">
                <div class="tool-icon-box"><i class="ti ${UI.categoryIcon(l.tools?.tool_categories?.name)}" aria-hidden="true"></i></div>
                <div class="tool-info">
                  <div class="tool-name">${l.tools?.name || '—'}</div>
                  <div class="tool-detail">${l.tools?.size_type || ''} · Qty: ${l.quantity}</div>
                </div>
                <div class="tool-actions">
                  <button class="btn-sm" onclick="App.tools.openTransfer('${l.tools?.id}','${jobId}')">
                    <i class="ti ti-arrows-exchange"></i> Transfer
                  </button>
                </div>
              </div>
            </div>`).join('');
      } catch (e) {
        console.error('Site tools error:', e);
        list.innerHTML = '<div class="empty-state"><i class="ti ti-alert-circle"></i><p>Error loading tools</p></div>';
      }
    },

    async loadAllSites() {
      const grid = document.getElementById('all-sites-list');
      const activeSites = State.jobs.filter(j => j.status === 'active');
      grid.innerHTML = activeSites.map(j => `
        <div class="site-card" onclick="App.tools.viewSite('${j.id}','${j.name}')">
          <div class="site-icon"><i class="ti ti-building" aria-hidden="true"></i></div>
          <div class="site-info">
            <div class="site-name">${j.name}</div>
            <div class="site-detail">${j.status}</div>
          </div>
          <i class="ti ti-chevron-right" style="color:#c7c7cc" aria-hidden="true"></i>
        </div>`).join('');
    },

    viewSite(jobId, jobName) {
      document.getElementById('my-site-select').value = jobId;
      this.loadSiteTools();
      document.getElementById('my-site-select').scrollIntoView({ behavior: 'smooth' });
    },

    openTransfer(toolId, fromJobId) {
      this._transferToolId = toolId;
      const tool = State.tools.find(t => t.id === toolId);
      document.getElementById('transfer-tool-label').textContent = tool ? `${tool.name}${tool.size_type ? ' — ' + tool.size_type : ''}` : 'Tool';

      const opts = State.jobs.map(j => `<option value="${j.id}"${j.id === fromJobId ? ' selected' : ''}>${j.name}</option>`).join('');
      document.getElementById('transfer-from').innerHTML = opts;
      document.getElementById('transfer-to').innerHTML = `<option value="">Select destination...</option>${opts}`;
      UI.openModal('modal-transfer');
    },

    async confirmTransfer() {
      const from = document.getElementById('transfer-from').value;
      const to   = document.getElementById('transfer-to').value;
      const qty  = parseInt(document.getElementById('transfer-qty').value);
      const cond = document.getElementById('transfer-condition').value;
      const notes = document.getElementById('transfer-notes').value.trim();

      if (!to) { UI.toast('Please select a destination', 'warning'); return; }
      if (from === to) { UI.toast('Source and destination cannot be the same', 'warning'); return; }
      if (!qty || qty < 1) { UI.toast('Quantity must be at least 1', 'warning'); return; }

      try {
        UI.setSyncDot('syncing');
        await DB.insert('tool_transfers', {
          tool_id: this._transferToolId,
          from_job_id: from,
          to_job_id: to,
          quantity: qty,
          condition: cond,
          transferred_by: State.user.id,
          notes: notes || null
        });
        UI.closeModal('modal-transfer');
        UI.toast('Transfer logged successfully', 'success');
        UI.setSyncDot('ok');
        await this.loadSiteTools();
        await this.loadStats();
      } catch (e) {
        UI.setSyncDot('error');
        UI.toast(e.message || 'Transfer failed. Please try again.', 'error');
      }
    },

    openAddTool(toolId = null) {
      const editing = !!toolId;
      document.getElementById('tool-modal-title').textContent = editing ? 'Edit tool' : 'Add tool';
      document.getElementById('tool-edit-id').value = toolId || '';
      if (!editing) {
        document.getElementById('tool-name').value = '';
        document.getElementById('tool-size').value = '';
        document.getElementById('tool-qty').value = 1;
        document.getElementById('tool-min').value = 0;
        document.getElementById('tool-consumable').checked = false;
      }
      UI.openModal('modal-tool');
    },

    async saveTool() {
      const id   = document.getElementById('tool-edit-id').value;
      const cat  = document.getElementById('tool-category').value;
      const name = document.getElementById('tool-name').value.trim();
      const size = document.getElementById('tool-size').value.trim();
      const qty  = parseInt(document.getElementById('tool-qty').value);
      const min  = parseInt(document.getElementById('tool-min').value);
      const cons = document.getElementById('tool-consumable').checked;

      if (!name) { UI.toast('Tool name is required', 'warning'); return; }

      try {
        const data = { category_id: cat, name, size_type: size || null, total_owned: qty, min_shop_stock: min, is_consumable: cons };
        if (id) {
          await DB.update('tools', id, data);
          UI.toast('Tool updated', 'success');
        } else {
          await DB.insert('tools', data);
          UI.toast('Tool added to inventory', 'success');
        }
        UI.closeModal('modal-tool');
        await this.load();
      } catch (e) {
        UI.toast(e.message || 'Save failed', 'error');
      }
    }
  },

  // ==================== TIME MODULE ====================
  time: {
    async load() {
      const wk = UI.weekStart();
      await this.loadWeekEntries(wk);
    },

    async checkActiveEntry() {
      // Check if user is already clocked in (handles page refresh)
      try {
        const entries = await DB.select('time_entries', {
          eq: { employee_id: State.user.id },
          order: 'clock_in_at',
          asc: false,
          limit: 1
        });
        const latest = entries[0];
        if (latest && !latest.clock_out_at) {
          State.activeTimeEntry = latest;
          const job = State.jobs.find(j => j.id === latest.job_id);
          this._setClockedInUI(job?.name || 'Unknown site');
          Geo.startTracking(latest.id);
          UI.toast('Resuming your clock-in from earlier', 'info');
        }
      } catch (e) { console.warn('Active entry check failed:', e); }
    },

    async loadWeekEntries(weekStart) {
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
      const list = document.getElementById('week-entries-list');

      try {
        const entries = await DB.select('time_entries', {
          select: '*, jobs(name)',
          eq: { employee_id: State.user.id },
          gte: { clock_in_at: weekStart.toISOString() },
          lte: { clock_in_at: weekEnd.toISOString() },
          order: 'clock_in_at',
          asc: false
        });

        if (!entries.length) {
          list.innerHTML = '<div class="empty-state"><i class="ti ti-clock"></i><p>No entries this week</p></div>';
          document.getElementById('week-total-display').textContent = '0.0 hrs';
          return;
        }

        const total = entries.reduce((s, e) => s + (parseFloat(e.hours_worked) || 0), 0);
        document.getElementById('week-total-display').textContent = `${total.toFixed(1)} hrs`;

        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        list.innerHTML = entries.map(e => `
          <div class="entry-row">
            <div class="entry-day">${days[new Date(e.clock_in_at).getDay()]}</div>
            <div class="entry-hours">${e.hours_worked ? parseFloat(e.hours_worked).toFixed(1) : '—'}</div>
            <div class="entry-detail">
              <div class="entry-job">${e.jobs?.name || '—'}</div>
              ${e.work_description ? `<div class="entry-desc">${e.work_description}</div>` : ''}
            </div>
            ${e.is_edited ? '<span class="badge badge-amber" style="font-size:10px">Edited</span>' : ''}
          </div>`).join('');
      } catch (e) {
        console.error('Week entries error:', e);
        list.innerHTML = '<div class="empty-state"><i class="ti ti-alert-circle"></i><p>Error loading entries</p></div>';
      }
    },

    async clockIn() {
      const jobId = document.getElementById('clockin-job-select').value;
      if (!jobId) { UI.toast('Please select a job site first', 'warning'); return; }

      // Prevent double clock-in
      if (State.activeTimeEntry) { UI.toast('You are already clocked in', 'warning'); return; }

      let lat = null, lng = null;
      try {
        const pos = await Geo.getPos();
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch { UI.toast('Location unavailable — clocking in without geo-tag', 'warning'); }

      try {
        UI.setSyncDot('syncing');
        const result = await DB.insert('time_entries', {
          employee_id: State.user.id,
          job_id: jobId,
          clock_in_at: new Date().toISOString(),
          clock_in_lat: lat,
          clock_in_lng: lng
        });

        if (result) {
          State.activeTimeEntry = result[0];
          Geo.startTracking(result[0].id);
        } else {
          // Offline — create local placeholder
          State.activeTimeEntry = { id: 'offline-' + Date.now(), job_id: jobId };
        }

        const job = State.jobs.find(j => j.id === jobId);
        this._setClockedInUI(job?.name || 'Job site');
        UI.setSyncDot('ok');
        UI.toast('Clocked in successfully', 'success');
      } catch (e) {
        UI.setSyncDot('error');
        UI.toast(e.message || 'Clock-in failed. Please try again.', 'error');
      }
    },

    _setClockedInUI(jobName) {
      document.getElementById('clock-card').classList.add('in');
      document.getElementById('clock-status-text').textContent = 'Clocked in';
      document.getElementById('clock-job-name').textContent = jobName;
      document.getElementById('clockin-section').style.display = 'none';
      document.getElementById('clockout-section').style.display = 'block';
      document.getElementById('geo-active').style.display = 'flex';

      // Running duration counter
      const start = new Date();
      State._durationInterval = setInterval(() => {
        const diff = (new Date() - start) / 3600000;
        document.getElementById('clock-duration').textContent = `${diff.toFixed(1)}h`;
      }, 60000);
    },

    _resetClockUI() {
      document.getElementById('clock-card').classList.remove('in');
      document.getElementById('clock-status-text').textContent = 'Not clocked in';
      document.getElementById('clock-job-name').textContent = '';
      document.getElementById('clock-duration').textContent = '';
      document.getElementById('clockin-section').style.display = 'block';
      document.getElementById('clockout-section').style.display = 'none';
      if (State._durationInterval) { clearInterval(State._durationInterval); State._durationInterval = null; }
    },

    promptClockOut() {
      const job = State.jobs.find(j => j.id === State.activeTimeEntry?.job_id);
      document.getElementById('clockout-modal-sub').textContent = `${job?.name || 'Current job'} — describe your work today`;
      document.getElementById('clockout-desc').value = '';
      UI.openModal('modal-clockout');
    },

    async confirmClockOut() {
      const desc = document.getElementById('clockout-desc').value.trim();
      if (!desc) { UI.toast('Please enter a brief work description', 'warning'); return; }

      let lat = null, lng = null;
      try {
        const pos = await Geo.getPos();
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch { /* silent */ }

      try {
        UI.setSyncDot('syncing');
        Geo.stopTracking();

        if (State.activeTimeEntry && !State.activeTimeEntry.id.startsWith('offline-')) {
          await DB.update('time_entries', State.activeTimeEntry.id, {
            clock_out_at: new Date().toISOString(),
            clock_out_lat: lat,
            clock_out_lng: lng,
            work_description: desc
          });
        } else {
          // Flush offline clock-in first, then clock-out
          await OfflineQueue.flush();
        }

        State.activeTimeEntry = null;
        this._resetClockUI();
        UI.closeModal('modal-clockout');
        UI.setSyncDot('ok');
        UI.toast('Clocked out successfully', 'success');
        await this.load();
      } catch (e) {
        UI.setSyncDot('error');
        UI.toast(e.message || 'Clock-out failed. Please try again.', 'error');
      }
    }
  },

  // ==================== ADMIN MODULE ====================
  admin: {
    async load() {
      await this.loadTimecards();
      await this.loadJobs();
      await this.loadTeam();
    },

    switchView(view, btn) {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('admin-timecards').style.display = view === 'timecards' ? 'block' : 'none';
      document.getElementById('admin-tools-view').style.display = view === 'tools' ? 'block' : 'none';
      document.getElementById('admin-jobs-view').style.display = view === 'jobs' ? 'block' : 'none';
      document.getElementById('admin-team-view').style.display = view === 'team' ? 'block' : 'none';
      if (view === 'tools') App.admin.loadAdminTools();
    },

    async loadTimecards() {
      const wk = State.adminWeek || UI.weekStart();
      const wkEnd = new Date(wk); wkEnd.setDate(wkEnd.getDate() + 7);
      document.getElementById('admin-week-label').textContent = `Week of ${UI.weekLabel(wk)}`;

      const list = document.getElementById('admin-tc-list');
      try {
        const tcs = await DB.select('timecards', {
          select: '*, profiles(first_name, last_name, initials, role)',
          gte: { week_start: wk.toISOString().split('T')[0] },
          lte: { week_start: wkEnd.toISOString().split('T')[0] }
        });

        // Also load all active employees to show those with no entries
        const allEmp = await DB.select('profiles', { eq: { is_active: true } });

        list.innerHTML = '';
        for (const emp of allEmp) {
          const tc = tcs.find(t => t.employee_id === emp.id);
          const hrs = tc?.total_hours ? parseFloat(tc.total_hours).toFixed(1) : '0.0';
          const status = tc?.status || 'in_progress';
          const row = document.createElement('div');
          row.className = 'emp-row';
          row.innerHTML = `
            <div class="emp-av">${emp.initials}</div>
            <div class="emp-info">
              <div class="emp-name">${emp.first_name} ${emp.last_name}</div>
              <div class="emp-detail">${hrs} hrs · ${emp.role.replace('_',' ')}</div>
            </div>
            ${UI.badgeHtml(status)}`;
          row.onclick = () => this.openTimecardDetail(emp, tc, wk);
          list.appendChild(row);
        }
      } catch (e) {
        console.error('Timecards load error:', e);
        list.innerHTML = '<div class="empty-state"><i class="ti ti-alert-circle"></i><p>Error loading timecards</p></div>';
      }
    },

    async openTimecardDetail(emp, tc, wk) {
      State.currentTimecardId = tc?.id || null;
      document.getElementById('tc-modal-title').textContent = `${emp.first_name} ${emp.last_name}`;
      document.getElementById('tc-modal-sub').textContent = `Week of ${UI.weekLabel(wk)}`;

      const wkEnd = new Date(wk); wkEnd.setDate(wkEnd.getDate() + 7);
      const list = document.getElementById('tc-entries-list');
      list.innerHTML = '<div class="empty-state"><i class="ti ti-loader"></i><p>Loading...</p></div>';

      try {
        const entries = await DB.select('time_entries', {
          select: '*, jobs(name)',
          eq: { employee_id: emp.id },
          gte: { clock_in_at: wk.toISOString() },
          lte: { clock_in_at: wkEnd.toISOString() },
          order: 'clock_in_at'
        });

        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const total = entries.reduce((s, e) => s + (parseFloat(e.hours_worked) || 0), 0);

        list.innerHTML = entries.length ? entries.map(e => `
          <div class="entry-row">
            <div class="entry-day">${days[new Date(e.clock_in_at).getDay()]}</div>
            <div class="entry-hours">${e.hours_worked ? parseFloat(e.hours_worked).toFixed(1) : '—'}</div>
            <div class="entry-detail">
              <div class="entry-job">${e.jobs?.name || '—'}</div>
              <div class="entry-desc">${UI.formatTime(e.clock_in_at)} → ${e.clock_out_at ? UI.formatTime(e.clock_out_at) : 'Still in'}</div>
              ${e.work_description ? `<div class="entry-desc" style="font-style:italic">"${e.work_description}"</div>` : ''}
              ${e.clock_in_lat ? `<div class="entry-desc">📍 ${parseFloat(e.clock_in_lat).toFixed(4)}°N ${Math.abs(parseFloat(e.clock_in_lng)).toFixed(4)}°W</div>` : ''}
              ${e.is_edited ? `<div class="entry-desc" style="color:var(--amber)">Edited</div>` : ''}
            </div>
          </div>`).join('') :
          '<div class="empty-state"><i class="ti ti-clock"></i><p>No entries this week</p></div>';

        document.getElementById('tc-modal-total').textContent = `${total.toFixed(1)} hrs`;

        const canApprove = tc && tc.status !== 'approved';
        document.getElementById('tc-approve-btn').style.display = canApprove ? 'flex' : 'none';
      } catch (e) {
        list.innerHTML = `<div class="empty-state"><i class="ti ti-alert-circle"></i><p>Error: ${e.message}</p></div>`;
      }

      UI.openModal('modal-timecard');
    },

    async approveTimecard() {
      if (!State.currentTimecardId) { UI.toast('No timecard to approve', 'warning'); return; }
      try {
        await DB.update('timecards', State.currentTimecardId, {
          status: 'approved',
          approved_by: State.user.id,
          approved_at: new Date().toISOString()
        });
        document.getElementById('tc-approve-btn').style.display = 'none';
        UI.toast('Timecard approved', 'success');
        await this.loadTimecards();
      } catch (e) { UI.toast(e.message || 'Approval failed', 'error'); }
    },

    editTimeEntry() {
      UI.toast('Select the entry in the list to edit — full edit flow coming in next build', 'info', 4000);
    },

    shiftWeek(dir) {
      State.adminWeek = State.adminWeek || UI.weekStart();
      State.adminWeek.setDate(State.adminWeek.getDate() + dir * 7);
      this.loadTimecards();
    },

    async exportTimecards() {
      UI.toast('Preparing export... check your Downloads folder shortly', 'info');
      // In production: generate CSV from time_entries and trigger download
      try {
        const wk = State.adminWeek || UI.weekStart();
        const wkEnd = new Date(wk); wkEnd.setDate(wkEnd.getDate() + 7);
        const entries = await DB.select('time_entries', {
          select: '*, profiles(first_name, last_name), jobs(name)',
          gte: { clock_in_at: wk.toISOString() },
          lte: { clock_in_at: wkEnd.toISOString() },
          order: 'clock_in_at'
        });

        const rows = [['Employee','Job','Date','Clock In','Clock Out','Hours','Description']];
        for (const e of entries) {
          rows.push([
            `${e.profiles?.first_name} ${e.profiles?.last_name}`,
            e.jobs?.name || '',
            new Date(e.clock_in_at).toLocaleDateString(),
            UI.formatTime(e.clock_in_at),
            e.clock_out_at ? UI.formatTime(e.clock_out_at) : '',
            e.hours_worked ? parseFloat(e.hours_worked).toFixed(2) : '',
            e.work_description || ''
          ]);
        }
        const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `HTC_Timecards_${wk.toISOString().split('T')[0]}.csv`;
        a.click();
        UI.toast('Export downloaded', 'success');
      } catch (e) { UI.toast('Export failed: ' + e.message, 'error'); }
    },

    async loadAdminTools() {
      const list = document.getElementById('admin-tools-list');
      try {
        const tools = await DB.select('tools', { select: '*, tool_categories(name)', order: 'name' });
        list.innerHTML = tools.map(t => `
          <div class="tool-card">
            <div class="tool-card-row">
              <div class="tool-icon-box"><i class="ti ${UI.categoryIcon(t.tool_categories?.name)}" aria-hidden="true"></i></div>
              <div class="tool-info">
                <div class="tool-name">${t.name}${t.size_type ? ' — ' + t.size_type : ''}</div>
                <div class="tool-detail">${t.tool_categories?.name || ''} · Owned: ${t.total_owned} · Min stock: ${t.min_shop_stock}</div>
              </div>
              <button class="btn-sm" onclick="App.tools.openAddTool('${t.id}')"><i class="ti ti-edit"></i></button>
            </div>
          </div>`).join('');
      } catch (e) { list.innerHTML = '<div class="empty-state"><p>Error loading tools</p></div>'; }
    },

    searchTools() {
      const q = document.getElementById('tools-search').value.toLowerCase();
      document.querySelectorAll('#admin-tools-list .tool-card').forEach(c => {
        const text = c.textContent.toLowerCase();
        c.style.display = text.includes(q) ? 'block' : 'none';
      });
    },

    async loadJobs() {
      const list = document.getElementById('admin-jobs-list');
      list.innerHTML = State.jobs.map(j => `
        <div class="job-card">
          <div class="job-num">${j.job_number}</div>
          <div class="job-info">
            <div class="job-name">${j.name}</div>
            <div class="job-detail">${j.city || ''} ${j.address ? '· ' + j.address : ''}</div>
          </div>
          ${UI.badgeHtml(j.status)}
        </div>`).join('');
    },

    openAddJob() { UI.openModal('modal-job'); },

    async saveJob() {
      const num    = document.getElementById('job-number').value.trim();
      const name   = document.getElementById('job-name-input').value.trim();
      const addr   = document.getElementById('job-address').value.trim();
      const city   = document.getElementById('job-city').value.trim();
      const status = document.getElementById('job-status-sel').value;

      if (!num || !name) { UI.toast('Job number and name are required', 'warning'); return; }

      try {
        await DB.insert('jobs', {
          job_number: num, name, address: addr || null,
          city: city || null, status, created_by: State.user.id
        });
        UI.closeModal('modal-job');
        UI.toast('Job created successfully', 'success');
        State.jobs = await DB.select('jobs', { order: 'name' });
        App._setupUI();
        await this.loadJobs();
      } catch (e) { UI.toast(e.message || 'Failed to create job', 'error'); }
    },

    async loadTeam() {
      const list = document.getElementById('admin-team-list');
      try {
        const profiles = await DB.select('profiles', { eq: { is_active: true }, order: 'first_name' });
        list.innerHTML = profiles.map(p => {
          const isAdmin = ['admin','foreman','project_manager','office'].includes(p.role);
          return `
            <div class="emp-row">
              <div class="emp-av">${p.initials}</div>
              <div class="emp-info">
                <div class="emp-name">${p.first_name} ${p.last_name}</div>
                <div class="emp-detail">${p.role.replace('_',' ')} · ${p.email || ''}</div>
              </div>
              <span class="badge ${isAdmin ? 'badge-purple' : 'badge-blue'}">${isAdmin ? 'Admin' : 'Field'}</span>
            </div>`;
        }).join('');
      } catch (e) { list.innerHTML = '<div class="empty-state"><p>Error loading team</p></div>'; }
    },

    openAddEmployee() {
      UI.toast('Invite via Supabase Auth Dashboard → Invite user, then assign role in Profiles table', 'info', 6000);
    }
  },

  // ==================== KIOSK MODULE ====================
  kiosk: {
    _pin: '',
    _user: null,
    _timeEntry: null,
    _durationInterval: null,

    async load() {
      const grid = document.getElementById('kiosk-emp-grid');
      try {
        const profiles = await DB.select('profiles', { eq: { is_active: true }, order: 'first_name' });
        grid.innerHTML = profiles.map(p => `
          <div class="emp-tile" onclick="App.kiosk.selectEmployee('${p.id}','${p.first_name} ${p.last_name}','${p.initials}','${p.role}')">
            <div class="emp-tile-av">${p.initials}</div>
            <div class="emp-tile-name">${p.first_name} ${p.last_name}</div>
            <div class="emp-tile-role">${p.role.replace('_',' ')}</div>
          </div>`).join('');
      } catch {
        // Fallback: show static grid if DB unavailable
        grid.innerHTML = '<div class="empty-state"><i class="ti ti-wifi-off"></i><p>Connect to internet to load employees</p></div>';
      }
    },

    selectEmployee(id, name, initials, role) {
      this._user = { id, name, initials, role };
      this._pin = '';
      document.getElementById('pin-name').textContent = name;
      document.getElementById('pin-avatar').textContent = initials;
      document.getElementById('pin-error').textContent = '';
      this._updatePinDots();
      document.getElementById('kiosk-select-screen').style.display = 'none';
      document.getElementById('kiosk-pin-screen').style.display = 'block';
    },

    back() {
      this._pin = '';
      document.getElementById('kiosk-pin-screen').style.display = 'none';
      document.getElementById('kiosk-select-screen').style.display = 'block';
      document.getElementById('pin-error').textContent = '';
    },

    pinPress(d) {
      if (this._pin.length >= 4) return;
      this._pin += d;
      this._updatePinDots();
      if (this._pin.length === 4) setTimeout(() => this._checkPin(), 150);
    },

    pinDel() { this._pin = this._pin.slice(0, -1); this._updatePinDots(); },
    pinClear() { this._pin = ''; this._updatePinDots(); document.getElementById('pin-error').textContent = ''; },

    _updatePinDots() {
      for (let i = 0; i < 4; i++) {
        const dot = document.getElementById(`pd${i}`);
        dot.className = 'pin-dot' + (i < this._pin.length ? ' filled' : '');
      }
    },

    async _checkPin() {
      // Verify PIN against Supabase (stored as bcrypt hash)
      // For demo: simple comparison. In production, use a secure server-side function.
      try {
        const { data, error } = await sb.rpc('verify_employee_pin', {
          p_employee_id: this._user.id,
          p_pin: this._pin
        });

        if (error || !data) {
          this._pinError();
          return;
        }

        // PIN correct — show job selector then clock-in
        const job = await this._kioskJobSelect();
        if (!job) { this.back(); return; }
        await this._kioskClockIn(job);
      } catch {
        // Fallback if RPC not set up: simple PIN check (demo mode)
        // In production, always use the RPC
        console.warn('PIN RPC not available, using demo mode');
        if (this._pin === '1234') {
          const job = State.jobs.find(j => j.status === 'active' && j.name !== 'Shop / Warehouse');
          if (job) await this._kioskClockIn({ id: job.id, name: job.name });
          else this.back();
        } else {
          this._pinError();
        }
      }
    },

    _pinError() {
      for (let i = 0; i < 4; i++) document.getElementById(`pd${i}`).className = 'pin-dot error';
      document.getElementById('pin-error').textContent = 'Incorrect PIN. Please try again.';
      this._pin = '';
      setTimeout(() => {
        this._updatePinDots();
        document.getElementById('pin-error').textContent = '';
      }, 1500);
    },

    async _kioskJobSelect() {
      return new Promise(res => {
        const sel = document.createElement('select');
        const activeJobs = State.jobs.filter(j => j.status === 'active' && j.name !== 'Shop / Warehouse');
        sel.innerHTML = activeJobs.map(j => `<option value="${j.id}">${j.name}</option>`).join('');

        // Simple inline selector
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;display:flex;align-items:flex-end';
        const panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:22px 22px 0 0;padding:20px;width:100%;max-height:80vh;overflow-y:auto';
        panel.innerHTML = `
          <div style="font-size:18px;font-weight:500;margin-bottom:14px">Select job site</div>
          <div id="kiosk-job-tiles" style="display:flex;flex-direction:column;gap:8px"></div>
          <button style="margin-top:14px;padding:10px 16px;border:0.5px solid #c7c7cc;border-radius:10px;background:transparent;font-size:14px;width:100%;cursor:pointer" onclick="this.closest('[data-overlay]').remove();window._kioskJobRes(null)">Cancel</button>`;
        overlay.dataset.overlay = '1';

        const tilesDiv = panel.querySelector('#kiosk-job-tiles');
        activeJobs.forEach(j => {
          const btn = document.createElement('button');
          btn.style.cssText = 'padding:14px;border:0.5px solid #e5e5ea;border-radius:10px;background:#fff;font-size:14px;text-align:left;cursor:pointer;width:100%';
          btn.textContent = j.name;
          btn.onclick = () => { overlay.remove(); res({ id: j.id, name: j.name }); };
          tilesDiv.appendChild(btn);
        });

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        window._kioskJobRes = res;
      });
    },

    async _kioskClockIn(job) {
      let lat = null, lng = null;
      try { const pos = await Geo.getPos(); lat = pos.coords.latitude; lng = pos.coords.longitude; } catch {}

      try {
        const result = await DB.insert('time_entries', {
          employee_id: this._user.id,
          job_id: job.id,
          clock_in_at: new Date().toISOString(),
          clock_in_lat: lat,
          clock_in_lng: lng
        });
        this._timeEntry = result?.[0] || { id: 'kiosk-offline-' + Date.now() };
        Geo.startTracking(this._timeEntry.id);
      } catch { this._timeEntry = { id: 'kiosk-offline-' + Date.now() }; }

      document.getElementById('kiosk-job-name').textContent = job.name;
      document.getElementById('kiosk-pin-screen').style.display = 'none';
      document.getElementById('kiosk-clocked-screen').style.display = 'block';

      const start = new Date();
      this._durationInterval = setInterval(() => {
        const h = ((new Date() - start) / 3600000).toFixed(1);
        document.getElementById('kiosk-duration').textContent = `${h}h`;
      }, 60000);
    },

    promptClockOut() {
      // Build inline clock-out prompt
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;display:flex;align-items:flex-end';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:22px 22px 0 0;padding:20px;width:100%">
          <div style="font-size:18px;font-weight:500;margin-bottom:4px">Clock out</div>
          <div style="font-size:13px;color:#8e8e93;margin-bottom:12px">What did you work on today?</div>
          <textarea id="kiosk-co-desc" style="width:100%;padding:10px 12px;border:0.5px solid #c7c7cc;border-radius:10px;font-size:14px;min-height:80px;font-family:inherit;resize:none;margin-bottom:10px" placeholder="Brief description of work completed..."></textarea>
          <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#8e8e93;margin-bottom:14px"><i class="ti ti-map-pin"></i> Geo-tag recorded at clock-out</div>
          <button onclick="App.kiosk._confirmClockOut(this)" style="width:100%;padding:12px;background:#d93025;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:500;cursor:pointer;margin-bottom:8px">Submit & clock out</button>
          <button onclick="this.closest('[data-kiosk-overlay]').remove()" style="width:100%;padding:10px;background:transparent;border:0.5px solid #c7c7cc;border-radius:10px;font-size:14px;cursor:pointer">Cancel</button>
        </div>`;
      overlay.dataset.kioskOverlay = '1';
      document.body.appendChild(overlay);
    },

    async _confirmClockOut(btn) {
      const desc = document.getElementById('kiosk-co-desc')?.value?.trim();
      if (!desc) { UI.toast('Please add a work description', 'warning'); return; }

      btn.textContent = 'Saving...'; btn.disabled = true;

      let lat = null, lng = null;
      try { const pos = await Geo.getPos(); lat = pos.coords.latitude; lng = pos.coords.longitude; } catch {}

      try {
        Geo.stopTracking();
        if (this._timeEntry && !String(this._timeEntry.id).startsWith('kiosk-offline-')) {
          await DB.update('time_entries', this._timeEntry.id, {
            clock_out_at: new Date().toISOString(),
            clock_out_lat: lat,
            clock_out_lng: lng,
            work_description: desc
          });
        }
      } catch { UI.toast('Saved offline — will sync when connected', 'warning'); }

      if (this._durationInterval) { clearInterval(this._durationInterval); this._durationInterval = null; }
      this._timeEntry = null;
      this._user = null;
      this._pin = '';

      document.querySelector('[data-kiosk-overlay]')?.remove();
      document.getElementById('kiosk-clocked-screen').style.display = 'none';
      document.getElementById('kiosk-select-screen').style.display = 'block';
      UI.toast('Clocked out. Have a great evening!', 'success');
    }
  }
};

// ============================================================
// REALTIME SUBSCRIPTIONS
// ============================================================
function setupRealtime() {
  // Live updates when time entries change (show in admin)
  sb.channel('time-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, payload => {
      console.log('Time entry changed:', payload.eventType);
      // Refresh admin timecards if admin tab is active
      const adminTab = document.getElementById('tab-admin');
      if (adminTab?.classList.contains('active')) {
        App.admin.loadTimecards();
      }
    })
    .subscribe();

  // Live tool location updates
  sb.channel('tool-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tool_locations' }, () => {
      App.tools.loadStats();
    })
    .subscribe();
}

// ============================================================
// STARTUP
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await App.init();
  setupRealtime();
  App.kiosk.load(); // Pre-load kiosk employee grid

  // Flush any queued offline data on load
  if (navigator.onLine) OfflineQueue.flush();
});

// Handle Enter key on login
document.getElementById('login-password')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') App.login();
});
