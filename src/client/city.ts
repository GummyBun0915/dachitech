/**
 * 城市页交互（方案 1「紧凑行」，用户 2026-10-21 选定）。
 * - 筛选：榜单 / 品类（维度内并集、维度间交集）+ 搜索；排序：分数（构建顺序）/ 最近吃 / 离我最近
 * - 状态写进 URL（?list=&category=&q=&sort=&view=map），可分享、返回可恢复
 * - 列表 ↔ 地图：PC 悬停行 → pin 放大；点行 → 居中 + 信息窗；点 pin → 行高亮并滚到可见
 * - 「只看地图范围内」（PC）；pin 显示分数，屏幕上挨太近的点聚合成数字圆，点开放大
 * - 手机：底部「地图」按钮切全屏地图（地图首次打开时才加载脚本）
 * 渐进增强：无 JS 时列表完整可见、链接可用。
 */
import { createAmap, createOsm, wgs2gcj, type LngLat, type MapApi } from "./map-provider";

type Pt = [number, number, string, string]; // lng, lat, 门店名, 导航链接
type Rec = { id: string; name: string; level: string; pts: Pt[] };
type Cfg = { provider: "amap" | "osm"; amap: { key: string; security: string } | null; withCoords: number };

const root = document.querySelector<HTMLElement>("[data-city]");
if (root) init(root);

function init(root: HTMLElement) {
  const { cfg, items: recs } = JSON.parse(root.querySelector("[data-map-data]")!.textContent || "{}") as { cfg: Cfg; items: Rec[] };
  const byId = new Map(recs.map((d) => [d.id, d]));
  const listEl = root.querySelector<HTMLElement>("[data-items]")!;
  const rows = [...listEl.querySelectorAll<HTMLElement>(".it")];
  const rowById = new Map(rows.map((el) => [el.dataset.id!, el]));
  const mapEl = root.querySelector<HTMLElement>("[data-map]")!;
  const msgEl = root.querySelector<HTMLElement>("[data-map-msg]")!;
  const fab = root.querySelector<HTMLButtonElement>("[data-fab]")!;
  const mobile = () => window.matchMedia("(max-width: 1023px)").matches;
  const hoverable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // ---------------- 筛选状态 ----------------
  const f = { levels: new Set<string>(), cats: new Set<string>(), prices: new Set<string>(), q: "", sort: "score", bounds: false };
  const qInput = root.querySelector<HTMLInputElement>("[data-q]")!;
  const sortSel = root.querySelector<HTMLSelectElement>("[data-sort]")!;
  const levelBtns = [...root.querySelectorAll<HTMLButtonElement>("button[data-f-level]")];
  const catBtns = [...root.querySelectorAll<HTMLButtonElement>("button[data-f-cat]")];
  const priceBtns = [...root.querySelectorAll<HTMLButtonElement>("button[data-f-price]")];
  const priceNote = root.querySelector<HTMLElement>("[data-price-note]");
  const band = new Map(priceBtns.map((b) => [b.dataset.fPrice!, [Number(b.dataset.lo), b.dataset.hi ? Number(b.dataset.hi) : Infinity] as const]));
  const countEl = root.querySelector<HTMLElement>("[data-count]")!;
  const emptyEl = root.querySelector<HTMLElement>("[data-empty]")!;

  // 从 URL 恢复（只认页面上存在的值，避免无效筛选清不掉）
  const sp = new URLSearchParams(location.search);
  const knownL = new Set(levelBtns.map((b) => b.dataset.fLevel!)), knownC = new Set(catBtns.map((b) => b.dataset.fCat!));
  (sp.get("list") ?? "").split(",").filter((x) => knownL.has(x)).forEach((x) => f.levels.add(x));
  (sp.get("category") ?? "").split(",").filter((x) => knownC.has(x)).forEach((x) => f.cats.add(x));
  (sp.get("price") ?? "").split(",").filter((x) => band.has(x)).forEach((x) => f.prices.add(x));
  f.q = (sp.get("q") ?? "").trim().toLowerCase(); qInput.value = sp.get("q") ?? "";
  if (["recent", "score"].includes(sp.get("sort") ?? "")) f.sort = sp.get("sort")!;
  sortSel.value = f.sort;
  levelBtns.forEach((b) => b.setAttribute("aria-pressed", String(f.levels.has(b.dataset.fLevel!))));
  catBtns.forEach((b) => b.setAttribute("aria-pressed", String(f.cats.has(b.dataset.fCat!))));
  priceBtns.forEach((b) => b.setAttribute("aria-pressed", String(f.prices.has(b.dataset.fPrice!))));

  function writeUrl() {
    const u = new URL(location.href);
    const set = (k: string, v: string) => (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
    set("list", [...f.levels].join(",")); set("category", [...f.cats].join(",")); set("price", [...f.prices].join(","));
    set("q", qInput.value.trim()); set("sort", f.sort === "score" || f.sort === "dist" ? "" : f.sort);
    set("view", root.classList.contains("show-map") ? "map" : "");
    history.replaceState(null, "", u);
  }

  const inBand = (p: number) => Number.isFinite(p) && [...f.prices].some((k) => { const [lo, hi] = band.get(k)!; return p >= lo && p < hi; });
  function apply() {
    let n = 0;
    for (const el of rows) {
      const rec = byId.get(el.dataset.id!)!;
      const ok = (!f.levels.size || f.levels.has(el.dataset.level!))
        && (!f.cats.size || el.dataset.cats!.split("|").some((c) => f.cats.has(c)))
        && (!f.prices.size || inBand(Number(el.dataset.price || NaN)))
        && (!f.q || el.dataset.hay!.includes(f.q));
      const inView = !f.bounds || !api || rec.pts.some((p) => api!.contains([p[0], p[1]]));
      el.hidden = !(ok && inView);
      el.dataset.match = ok ? "1" : "";
      if (!el.hidden) n++;
    }
    countEl.textContent = String(n);
    if (priceNote) priceNote.hidden = !f.prices.size;
    emptyEl.hidden = n > 0;
    draw();
  }
  levelBtns.concat(catBtns, priceBtns).forEach((b) => b.addEventListener("click", () => {
    const set = b.dataset.fLevel ? f.levels : b.dataset.fCat ? f.cats : f.prices;
    const k = (b.dataset.fLevel ?? b.dataset.fCat ?? b.dataset.fPrice)!;
    set.has(k) ? set.delete(k) : set.add(k);
    b.setAttribute("aria-pressed", String(set.has(k)));
    apply(); writeUrl();
  }));
  qInput.addEventListener("input", () => { f.q = qInput.value.trim().toLowerCase(); apply(); writeUrl(); });
  root.querySelector("[data-clear]")?.addEventListener("click", () => {
    f.levels.clear(); f.cats.clear(); f.prices.clear(); f.q = ""; qInput.value = "";
    levelBtns.concat(catBtns, priceBtns).forEach((b) => b.setAttribute("aria-pressed", "false"));
    const bx = root.querySelector<HTMLInputElement>("[data-bounds]"); if (bx) { bx.checked = false; f.bounds = false; }
    apply(); writeUrl();
  });

  // ---------------- 排序 / 定位 ----------------
  let me: LngLat | null = null; // 已换成本底图坐标系
  const meter = (a: LngLat, b: LngLat) => {
    const R = 6371000, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const distOf = (id: string) => {
    const rec = byId.get(id)!;
    return me && rec.pts.length ? Math.min(...rec.pts.map((p) => meter(me!, [p[0], p[1]]))) : Infinity;
  };
  function sort() {
    const s = [...rows].sort((a, b) => {
      if (f.sort === "dist") return distOf(a.dataset.id!) - distOf(b.dataset.id!);
      if (f.sort === "recent") return (b.dataset.visited ?? "").localeCompare(a.dataset.visited ?? "") || Number(a.dataset.i) - Number(b.dataset.i);
      return Number(a.dataset.i) - Number(b.dataset.i); // 构建时已按 星级 → 待吃 → 关店 排好
    });
    s.forEach((el) => listEl.appendChild(el));
  }
  function locate(then?: () => void) {
    if (!navigator.geolocation) { alert("这个浏览器不支持定位"); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      const { longitude: lng, latitude: lat } = p.coords;
      me = cfg.provider === "amap" ? wgs2gcj(lng, lat) : [lng, lat];
      rows.forEach((el) => {
        const d = distOf(el.dataset.id!);
        const out = el.querySelector<HTMLElement>("[data-dist]");
        if (out) out.textContent = Number.isFinite(d) ? (d < 1000 ? `${Math.round(d)}m` : `${(d / 1000).toFixed(1)}km`) : "";
      });
      api?.me(me);
      then?.();
    }, () => { alert("没拿到定位权限，换回按星级排序"); f.sort = "score"; sortSel.value = "score"; sort(); }, { timeout: 8000 });
  }
  sortSel.addEventListener("change", () => {
    f.sort = sortSel.value;
    if (f.sort === "dist" && !me) locate(sort); else sort();
    writeUrl();
  });
  sort();

  // ---------------- 地图 ----------------
  let api: MapApi | null = null;
  let loading: Promise<MapApi | null> | null = null;
  let activeId: string | null = null;
  const allPts = (): LngLat[] => recs.flatMap((r) => r.pts.map((p) => [p[0], p[1]] as LngLat));
  const showMsg = (html: string) => { msgEl.innerHTML = html; msgEl.hidden = false; };

  /** 首屏取景：只框主要聚集区（离中位点 > 25km 的外区分店不参与） */
  function fitMain() {
    const pts = allPts(); if (!api || !pts.length) return;
    const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const c: LngLat = [med(pts.map((p) => p[0])), med(pts.map((p) => p[1]))];
    const near = pts.filter((p) => meter(c, p) < 25000);
    api.fit(near.length ? near : pts);
  }

  function ensureMap(): Promise<MapApi | null> {
    if (loading) return loading;
    if (!cfg.withCoords) {
      showMsg(`<b>位置待补</b><span>这里的店还没核实坐标，先看列表；每家都能一键导航。</span>`);
      return (loading = Promise.resolve(null));
    }
    // 本地联调：高德 key 白名单不含 localhost 时，加 ?map=osm 用 OSM 底图验证交互（国内点会偏约 500m，仅调试）
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && sp.get("map") === "osm") cfg.provider = "osm";
    if (cfg.provider === "amap" && !cfg.amap?.key) {
      showMsg(`<b>地图未配置</b><span>先看列表，每家都能一键跳高德导航。</span>`);
      return (loading = Promise.resolve(null));
    }
    showMsg(`<span>地图加载中…</span>`);
    const first = allPts();
    const center: LngLat = [first.reduce((a, p) => a + p[0], 0) / first.length, first.reduce((a, p) => a + p[1], 0) / first.length];
    loading = (cfg.provider === "amap" ? createAmap(mapEl, cfg.amap!.key, cfg.amap!.security, center) : createOsm(mapEl))
      .then((m) => {
        api = m; msgEl.hidden = true;
        m.on("zoomend", draw);
        m.on("moveend", () => { if (f.bounds) apply(); });
        m.on("click", () => { activeId = null; rows.forEach((el) => el.classList.remove("is-on")); m.closePopup(); draw(); });
        if (me) m.me(me);
        fitMain(); draw(); // 若由点行触发，随后的 select 会把视野移到该店
        return m;
      })
      .catch(() => {
        showMsg(`<b>地图没加载出来</b><span>可以继续看列表，每家都能一键导航。</span><button type="button" class="map-btn" style="position:static;justify-self:center;height:34px;padding:0 14px;border-radius:6px">重试</button>`);
        msgEl.querySelector("button")?.addEventListener("click", () => { loading = null; mapEl.innerHTML = ""; ensureMap(); });
        return null;
      });
    return loading;
  }

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const LABEL: Record<string, string> = { s3: "★★★ 值得专程", s2: "★★ 值得绕路", s1: "★ 同类里出色", bib: "必吃登", sel: "星选", tbd: "待定级", daiChi: "待吃", closed: "已关店" };

  function popupEl(id: string, pt: Pt): HTMLElement {
    const row = rowById.get(id)!; const rec = byId.get(id)!;
    const imgEl = row.querySelector("img"); const img = imgEl?.getAttribute("src"); const pos = imgEl?.style.objectPosition || "50% 50%";
    const name = row.querySelector(".it-name")?.firstChild?.textContent?.trim() ?? "";
    const branch = rec.pts.length > 1 && pt[2] ? ` · ${pt[2]}` : (row.querySelector(".it-branch")?.textContent ?? "");
    const href = row.querySelector<HTMLAnchorElement>(".it-name")?.getAttribute("href") ?? "#";
    const line = [LABEL[rec.level] ?? "", row.querySelector(".it-price")?.textContent ?? ""].filter(Boolean).join(" · ");
    const box = document.createElement("div");
    box.className = "pop";
    box.innerHTML = (img ? `<img class="pop-img" src="${esc(img)}" style="object-position:${esc(pos)}" alt="">` : `<span class="pop-img"></span>`)
      + `<div><b>${esc(name)}${esc(branch)}</b><span class="pop-line">${esc(line)}</span>`
      + `<span class="pop-act"><a class="pop-nav" href="${esc(pt[3])}" target="_blank" rel="noopener noreferrer">导航</a><a class="pop-detail" href="${esc(href)}">详情</a></span></div>`;
    return box;
  }

  const RANK: Record<string, number> = { s3: 0, s2: 1, s1: 2, bib: 3, sel: 4, tbd: 5, daiChi: 6, closed: 7 };
  const RING: Record<string, string> = { s3: "var(--star)", s2: "var(--star)", s1: "var(--star)", bib: "var(--bib)", sel: "var(--ink-2)", tbd: "var(--ink-3)", daiChi: "#d98a1f", closed: "var(--line)" };
  const STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2l2.95 6.2 6.8.8-5.05 4.65 1.35 6.75L12 17.2l-6.05 3.4 1.35-6.75L2.25 9.2l6.8-.8z"/></svg>`;
  const NSTAR: Record<string, number> = { s3: 3, s2: 2, s1: 1 };
  const FORK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 21V3c-2 1-3 4-3 8h3"/></svg>`;
  const NAME_ZOOM = 15; // 街道级起气泡旁带店名

  /** 画点：店 = 带尖角分数气泡；屏幕上挨太近的聚合成「N 家」圆（环色 = 组内最高档）；选中店始终单独显示 */
  function draw() {
    if (!api) return;
    api.clear();
    // 「只看地图范围内」只影响列表，地图仍显示所有符合筛选的点，方便拖动寻找
    const show = new Set(rows.filter((el) => el.dataset.match !== "").map((el) => el.dataset.id!));
    const pins = recs.filter((r) => show.has(r.id)).flatMap((r) => r.pts.map((p) => ({ r, p, xy: api!.project([p[0], p[1]]) })));
    const named = api.zoom() >= NAME_ZOOM;
    const R = named ? 60 : 44; // 带店名时气泡更宽，聚合半径相应放大
    const used = new Set<number>();
    pins.forEach((a, i) => {
      if (used.has(i)) return;
      const group = [a];
      if (a.r.id !== activeId) pins.forEach((b, j) => {
        if (j <= i || used.has(j) || b.r.id === activeId) return;
        if (Math.hypot(a.xy.x - b.xy.x, a.xy.y - b.xy.y) < R) { group.push(b); used.add(j); }
      });
      if (group.length > 1) {
        const best = group.map((g) => g.r.level).sort((x, y) => RANK[x] - RANK[y])[0];
        const d = Math.min(52, 36 + group.length * 2);
        const names = group.map((g) => g.r.name).join("、");
        api!.add([a.p[0], a.p[1]], {
          html: `<div class="ck" style="--ring:${RING[best]};--d:${d}px" title="${esc(names)}"><b>${group.length}</b><small>家</small></div>`, z: 50,
          onClick: () => api!.fit(group.map((g) => [g.p[0], g.p[1]] as LngLat)),
        });
        return;
      }
      const on = a.r.id === activeId;
      const lv = a.r.level;
      const label = NSTAR[lv] ? `<span class="mk-st">${STAR.repeat(NSTAR[lv])}</span>` : lv === "bib" ? `<i class="mk-bib"></i>` : lv === "daiChi" ? "待吃" : FORK;
      const nm = a.r.pts.length > 1 && a.p[2] ? `${a.r.name}·${a.p[2]}` : a.r.name;
      api!.add([a.p[0], a.p[1]], {
        html: `<div class="mk mk--${lv}${on ? " is-on" : ""}${named ? " with-name" : ""}" title="${esc(nm)}">${label}<span class="mk-n">${esc(nm)}</span></div>`,
        z: on ? 1000 : 60 - RANK[lv] * 8,
        onClick: () => select(a.r.id, "map", a.p),
        onHover: hoverable ? () => { highlight(a.r.id); } : undefined,
      });
    });
  }

  function highlight(id: string | null) {
    if (activeId === id) return;
    activeId = id;
    rows.forEach((el) => el.classList.toggle("is-on", el.dataset.id === id));
    draw();
  }

  function select(id: string, from: "map" | "list", pt?: Pt) {
    const rec = byId.get(id); const p = pt ?? rec?.pts[0];
    highlight(id);
    if (!api || !p) return;
    if (from === "list") api.setView([p[0], p[1]], 15);
    api.popup([p[0], p[1]], popupEl(id, p));
    if (from === "map" && !mobile()) rowById.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // 行 → 地图（点行空白处；链接 / 看图按钮各管各的）
  rows.forEach((el) => {
    el.addEventListener("click", async (e) => {
      if ((e.target as HTMLElement).closest("a, button")) return;
      const rec = byId.get(el.dataset.id!);
      if (!rec?.pts.length) return;
      if (mobile()) setView(true, true);
      const m = await ensureMap(); if (!m) return;
      if (mobile()) m.resize();
      select(el.dataset.id!, "list");
    });
    if (hoverable) el.addEventListener("mouseenter", () => {
      if (api && byId.get(el.dataset.id!)?.pts.length) highlight(el.dataset.id!);
    });
  });

  // 手机：列表 ↔ 全屏地图
  function setView(map: boolean, fromRow = false) {
    root.classList.toggle("show-map", map);
    fab.textContent = map ? "列表" : "地图";
    fab.setAttribute("aria-pressed", String(map));
    writeUrl();
    if (map) ensureMap().then((m) => { if (m) { m.resize(); if (!fromRow && !activeId) fitMain(); } });
  }
  fab.addEventListener("click", () => setView(!root.classList.contains("show-map")));

  root.querySelector("[data-reset]")?.addEventListener("click", () => {
    api?.closePopup(); activeId = null; rows.forEach((el) => el.classList.remove("is-on"));
    fitMain(); draw();
  });
  root.querySelector("[data-locate]")?.addEventListener("click", () => {
    const go = () => me && api?.setView(me, 15);
    me ? go() : locate(go);
  });
  root.querySelector<HTMLInputElement>("[data-bounds]")?.addEventListener("change", (e) => {
    f.bounds = (e.target as HTMLInputElement).checked; apply();
  });

  apply();
  // PC 地图常驻 → 立即加载；手机只在打开地图时加载（省流量）
  if (!mobile()) ensureMap();
  else if (sp.get("view") === "map") setView(true);
  window.matchMedia("(max-width: 1023px)").addEventListener("change", (e) => {
    if (!e.matches) { root.classList.remove("show-map"); ensureMap().then((m) => m?.resize()); }
  });
}
