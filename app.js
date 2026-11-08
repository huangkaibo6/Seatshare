/* =========================================================
   空座 H5 — 单线路验证版
   纯前端，数据存 localStorage，无后端依赖
   ========================================================= */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const STORAGE_KEY = 'kongzuo_v1';
const MIN_PER_STATION = 2;      // 每站约 2 分钟
const EXPIRE_AFTER_MIN = 2;     // 到站后 2 分钟失效
const MAX_STOPS_AHEAD = 5;      // 最多看前方 5 站
const SEATS_PER_CAR = 40;       // 一节车厢约 40 个座位

/* ---------------- 线路数据 ---------------- */
const LINES = {
  '9': {
    name: '9 号线',
    stations: ['松江南站', '醉白池', '松江体育中心', '松江新城', '松江大学城', '洞泾', '佘山', '泗泾',
      '九亭', '中春路', '七宝', '星中路', '合川路', '漕河泾开发区', '桂林路', '宜山路', '徐家汇',
      '肇嘉浜路', '打浦桥', '马当路', '陆家浜路', '小南门', '商城路', '世纪大道', '杨高中路',
      '芳甸路', '蓝天路', '台儿庄路', '金桥', '金吉路', '金海路', '顾唐路', '民雷路', '曹路']
  },
  '2': {
    name: '2 号线',
    stations: ['徐泾东', '虹桥火车站', '虹桥2号航站楼', '淞虹路', '北新泾', '威宁路', '娄山关路', '中山公园',
      '江苏路', '静安寺', '南京西路', '人民广场', '南京东路', '陆家嘴', '东昌路', '世纪大道',
      '上海科技馆', '世纪公园', '龙阳路', '张江高科', '金科路', '广兰路', '唐镇', '创新中路',
      '华夏东路', '川沙', '凌空路', '远东大道', '海天三路', '浦东国际机场']
  }
};

/* ---------------- 状态 ---------------- */
const state = {
  tab: 'find',
  line: '9',
  dir: 0,             // 0 = 站序递增方向，1 = 反向
  stationIdx: 8,
  postCar: 4,
  postFromIdx: 8,
  postToIdx: 16,
  seedUsed: false
};

let db = { posts: [], stats: { posts: 0, views: 0, hits: 0 }, seeded: false };
let tickTimer = null;

/* ---------------- 工具函数 ---------------- */
function lineStations() { return LINES[state.line].stations; }
function dirSign() { return state.dir === 0 ? 1 : -1; }
function dirLabel() {
  const st = lineStations();
  return state.dir === 0 ? '往' + st[st.length - 1] : '往' + st[0];
}
function uid() { return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function fmtMinutes(ms) {
  const m = Math.round(ms / 60000);
  if (m <= 0) return '即将';
  if (m === 1) return '约 1 分钟';
  return '约 ' + m + ' 分钟';
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2000);
}

/* ---------------- 存储 ---------------- */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) db = JSON.parse(raw);
  } catch (e) { /* ignore */ }
  if (!db.posts) db.posts = [];
  if (!db.stats) db.stats = { posts: 0, views: 0, hits: 0 };
  if (!db.seeded) { seed(); db.seeded = true; save(); }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
}

/* ---------------- 演示数据 ----------------
   仅供首次打开时看到界面效果，卡片上会标记「演示」
   正式上线前删掉 seed() 即可 */
function seed() {
  const now = Date.now();
  const FROM = 7; // 泗泾，演示时假定列车刚过这一站
  const samples = [
    { car: 2, toIdx: 9 },
    { car: 4, toIdx: 10 },
    { car: 1, toIdx: 11 },
    { car: 6, toIdx: 12 },
    { car: 3, toIdx: 13 }
  ];
  db.posts = samples.map((s, i) => ({
    id: 'seed_' + i,
    line: '9',
    dir: 0,
    car: s.car,
    fromIdx: FROM,
    toIdx: s.toIdx,
    createdAt: now,
    arriveAt: now + (s.toIdx - FROM) * MIN_PER_STATION * 60000,
    reports: 0,
    demo: true
  }));
}

/* ---------------- 帖子有效性 ---------------- */
function isValid(p, now) {
  if (p.reports >= 3) return false;
  if (now > p.arriveAt + EXPIRE_AFTER_MIN * 60000) return false;
  return true;
}

/* 列车当前位置（估算，单位：站） */
function trainPosition(p, now) {
  const elapsedMin = (now - p.createdAt) / 60000;
  const moved = elapsedMin / MIN_PER_STATION;
  return p.fromIdx + (p.dir === 0 ? 1 : -1) * moved;
}

/* 只返回查询者能等到、且在前方 5 站内的帖子 */
function visiblePosts(now) {
  return db.posts.filter((p) => {
    if (!isValid(p, now)) return false;
    if (p.line !== state.line || p.dir !== state.dir) return false;
    const sign = dirSign();
    // 下车站必须在查询站前方
    if ((p.toIdx - state.stationIdx) * sign <= 0) return false;
    // 列车还没开过查询站
    const pos = trainPosition(p, now);
    if ((pos - state.stationIdx) * sign > 0.6) return false;
    // 前方 5 站以内
    if (Math.abs(p.toIdx - state.stationIdx) > MAX_STOPS_AHEAD) return false;
    return true;
  }).sort((a, b) => {
    const da = Math.abs(a.toIdx - state.stationIdx);
    const dbb = Math.abs(b.toIdx - state.stationIdx);
    if (da !== dbb) return da - dbb;
    return a.car - b.car;
  });
}

/* ---------------- 渲染：找空座 ---------------- */
function renderFind() {
  const st = lineStations();
  $('#valLine').textContent = LINES[state.line].name;
  $('#valDir').textContent = dirLabel();
  $('#valStation').textContent = st[state.stationIdx];

  const now = Date.now();
  const list = visiblePosts(now);
  const box = $('#resultList');
  $('#resultCount').textContent = list.length + ' 个空座';

  if (!list.length) {
    box.innerHTML = `
      <div class="empty">
        <div class="empty-mark">◌</div>
        <div class="empty-title">这一站暂时没有信息</div>
        <div class="empty-desc">车上的人还没发布。<br>换个站看看，或者你自己就是坐着的那位？</div>
      </div>`;
    return;
  }

  box.innerHTML = list.map((p) => {
    const stops = Math.abs(p.toIdx - state.stationIdx);
    const remain = p.arriveAt - now;
    return `
      <div class="seat-card" data-id="${p.id}">
        <div class="car-badge">
          <div class="car-num">${p.car}</div>
          <div class="car-unit">车厢</div>
        </div>
        <div class="seat-main">
          <div class="seat-when">
            <span class="seat-stops"><em>${stops}</em> 站后</span>
            <span class="seat-time" data-time="${p.id}">${fmtMinutes(remain)}</span>
          </div>
          <div class="seat-dest">在 <b>${st[p.toIdx]}</b> 下车${p.demo ? ' · 演示数据' : ''}</div>
        </div>
        <div class="seat-actions">
          <button class="btn-take" data-take="${p.id}">我坐上了</button>
          <button class="btn-report" data-report="${p.id}">举报</button>
        </div>
      </div>`;
  }).join('');
}

/* ---------------- 渲染：发布页 ---------------- */
function renderPost() {
  const st = lineStations();

  // 车厢选择
  $('#carGrid').innerHTML = [1, 2, 3, 4, 5, 6].map((n) =>
    `<button class="car-btn ${state.postCar === n ? 'active' : ''}" data-car="${n}">${n}</button>`
  ).join('');

  $('#valFrom').textContent = st[state.postFromIdx];
  $('#valTo').textContent = st[state.postToIdx];

  // 我的发布
  const mine = db.posts.filter((p) => p.mine && isValid(p, Date.now()));
  $('#myPostsWrap').style.display = mine.length ? 'block' : 'none';
  $('#myPostsList').innerHTML = mine.map((p) => {
    const remain = p.arriveAt - Date.now();
    return `
      <div class="my-post-item">
        <div class="my-post-car">${p.car}</div>
        <div class="my-post-main">
          <div class="my-post-title">${st[p.toIdx]} 下车</div>
          <div class="my-post-sub">${fmtMinutes(remain)} 后空出 · ${p.reports > 0 ? '被举报 ' + p.reports + ' 次' : '正在展示'}</div>
        </div>
        <button class="btn-revoke" data-revoke="${p.id}">撤销</button>
      </div>`;
  }).join('');
}

/* ---------------- 渲染：数据页 ---------------- */
function renderStats() {
  const now = Date.now();
  const active = db.posts.filter((p) => isValid(p, now) && !p.demo).length;
  const rate = db.stats.views > 0 ? Math.round((db.stats.hits / db.stats.views) * 100) : 0;
  const coverage = Math.min(100, Math.round((active / SEATS_PER_CAR) * 100));

  $('#statPosts').textContent = db.stats.posts;
  $('#statViews').textContent = db.stats.views;
  $('#statHits').textContent = db.stats.hits;
  $('#statRate').textContent = db.stats.views > 0 ? rate + '%' : '—';

  $('#gaugeVal').textContent = coverage + '%';
  $('#gaugeFill').style.width = coverage + '%';
}

/* ---------------- 选择器 ---------------- */
let pickerState = { items: [], index: 0, onOk: null };

function openPicker(title, items, current, onOk) {
  pickerState.items = items;
  pickerState.index = current;
  pickerState.onOk = onOk;
  $('#pickerTitle').textContent = title;
  renderPickerBody();
  $('#pickerMask').classList.add('show');
}

function renderPickerBody() {
  $('#pickerBody').innerHTML = pickerState.items.map((it, i) =>
    `<div class="picker-item ${i === pickerState.index ? 'active' : ''}" data-pick="${i}">${it}</div>`
  ).join('');
  const active = $('#pickerBody .picker-item.active');
  if (active) active.scrollIntoView({ block: 'center' });
}

function closePicker() { $('#pickerMask').classList.remove('show'); }

/* ---------------- Tab 切换 ---------------- */
function switchTab(tab) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.page').forEach((p) => p.classList.remove('active'));
  state.tab = tab;
  $('#page-' + tab).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (tab === 'find') { db.stats.views++; save(); renderFind(); }
  if (tab === 'post') renderPost();
  if (tab === 'stats') renderStats();
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  /* Tab 切换 */
  $$('.tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /* 线路 */
  $('#selLine').addEventListener('click', () => {
    openPicker('选择线路', Object.keys(LINES).map((k) => LINES[k].name), Object.keys(LINES).indexOf(state.line), (i) => {
      state.line = Object.keys(LINES)[i];
      state.stationIdx = 8;
      state.postFromIdx = 8;
      state.postToIdx = 16;
      renderFind(); renderPost();
    });
  });

  /* 方向 */
  $('#selDir').addEventListener('click', () => {
    const st = lineStations();
    openPicker('选择方向', ['往' + st[st.length - 1], '往' + st[0]], state.dir, (i) => {
      state.dir = i;
      renderFind();
    });
  });

  /* 我在哪站 */
  $('#selStation').addEventListener('click', () => {
    openPicker('你在哪一站', lineStations(), state.stationIdx, (i) => {
      state.stationIdx = i;
      renderFind();
    });
  });

  /* 发布：车厢 */
  $('#carGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-car]');
    if (!btn) return;
    state.postCar = Number(btn.dataset.car);
    renderPost();
  });

  /* 发布：当前站 */
  $('#postFrom').addEventListener('click', () => {
    openPicker('你现在在哪一站附近', lineStations(), state.postFromIdx, (i) => {
      state.postFromIdx = i;
      const sign = dirSign();
      if ((state.postToIdx - i) * sign <= 0) {
        state.postToIdx = clampIndex(i + sign * 3);
      }
      renderPost();
    });
  });

  /* 发布：下车站（只列前方站） */
  $('#postTo').addEventListener('click', () => {
    const st = lineStations();
    const sign = dirSign();
    const idxs = [];
    for (let i = 1; i < st.length; i++) {
      const idx = state.postFromIdx + sign * i;
      if (idx < 0 || idx >= st.length) break;
      idxs.push(idx);
    }
    if (!idxs.length) { showToast('这个方向已经没有后续站了'); return; }
    const items = idxs.map((i) => st[i]);
    const cur = Math.max(0, idxs.indexOf(state.postToIdx));
    openPicker('你将在哪一站下车', items, cur, (k) => {
      state.postToIdx = idxs[k];
      renderPost();
    });
  });

  /* 发布按钮 */
  $('#btnPublish').addEventListener('click', () => {
    const now = Date.now();
    const stops = Math.abs(state.postToIdx - state.postFromIdx);
    if (stops <= 0) { showToast('下车站要在当前站之后'); return; }

    const p = {
      id: uid(),
      line: state.line,
      dir: state.dir,
      car: state.postCar,
      fromIdx: state.postFromIdx,
      toIdx: state.postToIdx,
      createdAt: now,
      arriveAt: now + stops * MIN_PER_STATION * 60000,
      reports: 0,
      mine: true
    };
    db.posts.push(p);
    db.stats.posts++;
    save();
    renderPost();
    showToast('已发布，站着的人会看到你的座位');
  });

  /* 结果区操作 */
  $('#resultList').addEventListener('click', (e) => {
    const take = e.target.closest('[data-take]');
    const report = e.target.closest('[data-report]');
    if (take) {
      const id = take.dataset.take;
      db.stats.hits++;
      db.posts = db.posts.filter((p) => p.id !== id);
      save();
      renderFind();
      showToast('祝坐得舒服');
      return;
    }
    if (report) {
      const id = report.dataset.report;
      const p = db.posts.find((x) => x.id === id);
      if (!p) return;
      p.reports = (p.reports || 0) + 1;
      if (p.reports >= 3) {
        db.posts = db.posts.filter((x) => x.id !== id);
        showToast('已隐藏，感谢反馈');
      } else {
        showToast('已记录（' + p.reports + '/3）');
      }
      save();
      renderFind();
    }
  });

  /* 撤销我的发布 */
  $('#myPostsList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-revoke]');
    if (!btn) return;
    db.posts = db.posts.filter((p) => p.id !== btn.dataset.revoke);
    save();
    renderPost();
    showToast('已撤销');
  });

  /* 选择器 */
  $('#pickerBody').addEventListener('click', (e) => {
    const it = e.target.closest('[data-pick]');
    if (!it) return;
    pickerState.index = Number(it.dataset.pick);
    renderPickerBody();
  });
  $('#pickerOk').addEventListener('click', () => {
    const cb = pickerState.onOk;
    const i = pickerState.index;
    closePicker();
    if (cb) cb(i);
  });
  $('#pickerCancel').addEventListener('click', closePicker);
  $('#pickerMask').addEventListener('click', (e) => {
    if (e.target === $('#pickerMask')) closePicker();
  });

  /* 重置 */
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('清空本地所有数据？包括发布记录和统计。')) return;
    db = { posts: [], stats: { posts: 0, views: 0, hits: 0 }, seeded: false };
    localStorage.removeItem(STORAGE_KEY);
    load();
    renderFind(); renderPost(); renderStats();
    showToast('已清空');
  });
}

function clampIndex(i) {
  const st = lineStations();
  return Math.max(0, Math.min(st.length - 1, i));
}

/* ---------------- 每秒刷新 ---------------- */
function startTick() {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const now = Date.now();
    // 只更新倒计时文本，避免整表重绘
    $$('[data-time]').forEach((el) => {
      const p = db.posts.find((x) => x.id === el.dataset.time);
      if (!p) return;
      el.textContent = fmtMinutes(p.arriveAt - now);
    });
    // 失效清理
    const before = db.posts.length;
    db.posts = db.posts.filter((p) => now <= p.arriveAt + EXPIRE_AFTER_MIN * 60000);
    if (db.posts.length !== before) {
      save();
      if (state.tab === 'find') renderFind();
      if (state.tab === 'post') renderPost();
    }
  }, 1000);
}

/* ---------------- 启动 ---------------- */
function init() {
  load();
  bindEvents();
  const hash = location.hash.replace('#', '');
  if (['find', 'post', 'stats'].includes(hash)) switchTab(hash);
  else renderFind();
  renderPost();
  renderStats();
  startTick();
}

document.addEventListener('DOMContentLoaded', init);
