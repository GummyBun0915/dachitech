/**
 * 地图底座抽象：城市页交互（city.ts）只认这一层，不直接碰高德 / Leaflet。
 * - amap：国内，高德 JS API 2.0（坐标 GCJ-02，与表内一致）；需 key + 域名白名单
 * - osm：海外，Leaflet + OpenStreetMap（坐标 WGS-84），免 key
 * 坐标一律 [lng, lat]。
 */
export type LngLat = [number, number];
export interface MarkerOpts { html: string; z?: number; onClick?: () => void; onHover?: () => void }
export interface MapApi {
  clear(): void;
  add(at: LngLat, o: MarkerOpts): void;
  fit(pts: LngLat[]): void;
  setView(at: LngLat, minZoom: number): void;
  project(at: LngLat): { x: number; y: number };
  contains(at: LngLat): boolean;
  popup(at: LngLat, el: HTMLElement): void;
  closePopup(): void;
  on(evt: "zoomend" | "moveend" | "click", fn: () => void): void;
  resize(): void;
  /** 「我的位置」小圆点；坐标已是本底图坐标系 */
  me(at: LngLat): void;
}

declare global {
  interface Window { AMap?: any; _AMapSecurityConfig?: { securityJsCode: string } }
}

function loadScript(src: string): Promise<void> {
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => ok(); s.onerror = () => fail(new Error("地图脚本加载失败"));
    document.head.appendChild(s);
  });
}

export async function createAmap(el: HTMLElement, key: string, security: string, center: LngLat): Promise<MapApi> {
  if (!window.AMap) {
    window._AMapSecurityConfig = { securityJsCode: security };
    await loadScript(`https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`);
  }
  const AMap = window.AMap;
  if (!AMap) throw new Error("AMap 未就绪");
  // 必须给 center：不给时高德会异步按 IP 定位城市中心，把我们随后设的视野覆盖掉
  const map = new AMap.Map(el, { zoom: 12, center, resizeEnable: true, viewMode: "2D" });
  // 不等底图 complete：首屏瓦片在手机上可能 >8s，等待会把「其实能用的地图」误判为失败；点位与交互不依赖瓦片
  let markers: any[] = [];
  const info = new AMap.InfoWindow({ isCustom: true, autoMove: true, anchor: "bottom-center", offset: new AMap.Pixel(0, -16) });
  return {
    clear() { if (markers.length) map.remove(markers); markers = []; },
    add(at, o) {
      const box = document.createElement("div");
      box.innerHTML = o.html;
      const node = box.firstElementChild as HTMLElement;
      node.addEventListener("click", (e) => { e.stopPropagation(); o.onClick?.(); });
      if (o.onHover) node.addEventListener("mouseenter", o.onHover);
      const m = new AMap.Marker({ position: at, content: node, anchor: "top-left", zIndex: 100 + (o.z ?? 0) });
      markers.push(m); map.add(m);
    },
    fit(pts) {
      if (!pts.length) return;
      const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
      const b = new AMap.Bounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]);
      map.setBounds(b, false, [50, 50, 50, 50]);
      if (map.getZoom() > 16) map.setZoom(16);
    },
    setView(at, z) { map.setZoomAndCenter(Math.max(map.getZoom(), z), at); },
    project(at) { const p = map.lngLatToContainer(at); return { x: p.getX(), y: p.getY() }; },
    contains(at) { return map.getBounds().contains(at); },
    popup(at, node) {
      const wrap = document.createElement("div"); wrap.className = "map-pop"; wrap.appendChild(node);
      info.setContent(wrap); info.open(map, at);
    },
    closePopup() { info.close(); },
    on(evt, fn) { map.on(evt, fn); },
    resize() { map.resize?.(); },
    me(at) { new AMap.CircleMarker({ center: at, radius: 7, strokeColor: "#fff", strokeWeight: 2, fillColor: "#2451e6", fillOpacity: 1, zIndex: 300 }).setMap(map); },
  };
}

export async function createOsm(el: HTMLElement): Promise<MapApi> {
  const L = (await import("leaflet")).default;
  // @ts-ignore 样式由 Vite 处理，无类型声明
  await import("leaflet/dist/leaflet.css");
  const map = L.map(el, { zoomControl: false });
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const ll = (at: LngLat) => L.latLng(at[1], at[0]);
  map.setView([0, 0], 2);
  return {
    clear() { layer.clearLayers(); },
    add(at, o) {
      const m = L.marker(ll(at), { zIndexOffset: o.z ?? 0, icon: L.divIcon({ className: "pin-wrap", html: o.html, iconSize: [0, 0] }) });
      if (o.onClick) m.on("click", o.onClick);
      if (o.onHover) m.on("mouseover", o.onHover);
      m.addTo(layer);
    },
    fit(pts) {
      if (!pts.length) return;
      map.fitBounds(L.latLngBounds(pts.map(ll)), { padding: [50, 50], maxZoom: 16 });
    },
    setView(at, z) { map.setView(ll(at), Math.max(map.getZoom(), z)); },
    project(at) { const p = map.latLngToContainerPoint(ll(at)); return { x: p.x, y: p.y }; },
    contains(at) { return map.getBounds().contains(ll(at)); },
    popup(at, node) { L.popup({ offset: [0, -12], closeButton: false }).setLatLng(ll(at)).setContent(node).openOn(map); },
    closePopup() { map.closePopup(); },
    on(evt, fn) { map.on(evt, fn); },
    resize() { map.invalidateSize(); },
    me(at) { L.circleMarker(ll(at), { radius: 7, color: "#fff", weight: 2, fillColor: "#2451e6", fillOpacity: 1 }).addTo(map); },
  };
}

/** WGS-84 → GCJ-02（浏览器定位是 WGS-84；国内底图要先换算，否则偏 ~500m） */
export function wgs2gcj(lng: number, lat: number): LngLat {
  const a = 6378245.0, ee = 0.00669342162296594323;
  const tLat = (x: number, y: number) => -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
    + ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
    + ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3
    + ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  const tLng = (x: number, y: number) => 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
    + ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
    + ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3
    + ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  let dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
  const rad = (lat / 180) * Math.PI;
  let m = Math.sin(rad); m = 1 - ee * m * m;
  const sm = Math.sqrt(m);
  dLat = (dLat * 180) / (((a * (1 - ee)) / (m * sm)) * Math.PI);
  dLng = (dLng * 180) / ((a / sm) * Math.cos(rad) * Math.PI);
  return [lng + dLng, lat + dLat];
}
