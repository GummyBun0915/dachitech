/**
 * UI 只消费生成的公共投影（DEVELOPMENT-PLAN §5：UI 不现场清洗源数据）。
 */
import generated from "../data/restaurants.generated.json";

export interface PubDish { name: string; review?: string; score10?: number | null }
export interface PubRestaurant {
  id: string; slug: string; regionSlug: string; actualCity: string;
  brand: string; branch: string | null; category: string | null; cuisineTags: string[];
  reviewText: string; dishes: PubDish[];
  score10: number | null; scoreScope: "restaurant" | "none";
  recommendationLevel: "wubiChi" | "yingChiBang" | "keyiChi" | "daiChi";
  visitedAt: string | null; visitedAtPrecision: "day" | "month" | null;
  inRecent: boolean; multiShop: boolean; amapQuery: string;
  lng: number | null; lat: number | null; coordSystem: string | null; poiConfidence: string | null;
  closed: boolean;
  avgPrice: number | null;   // 人均（元），选填
  address: string;           // 单店地址，选填
  branches: PubBranch[];     // 同品牌多门店；单店为空数组
  contentUpdatedAt: string; coverImage: string | null;
  images: PubImage[];        // 实拍图（第 1 张为封面）；路径不含 base
}
export interface PubImage { src: string; thumb: string; w: number; h: number }
export interface PubBranch {
  id: string; name: string; address: string;
  lng: number | null; lat: number | null;
  score10: number | null; visitedAt: string | null; closed: boolean; amapQuery: string;
}

export const data = generated as unknown as {
  generatedAt: string;
  policyVersion: string;
  recentWindowDays: number;
  regions: Array<{ slug: string; name: string; count: number }>;
  restaurants: PubRestaurant[];
};

export const restaurants = data.restaurants;

export const REGION_ORDER = ["shenzhen", "zhongshan", "chongqing", "guangzhou", "japan", "singapore", "thailand"] as const;
export const regionName = (slug: string) => data.regions.find((r) => r.slug === slug)?.name ?? slug;
export const regionCount = (slug: string) => data.regions.find((r) => r.slug === slug)?.count ?? 0;
export const regionWait = (slug: string) => (data.regions.find((r) => r.slug === slug) as any)?.wait ?? 0;
export const byRegion = (slug: string) => restaurants.filter((r) => r.regionSlug === slug);
export const eatenByRegion = (slug: string) => byRegion(slug).filter(isEaten);
export const waitByRegion = (slug: string) => byRegion(slug).filter((r) => r.recommendationLevel === "daiChi");

/** 推荐用语只允许这四个（DEVELOPMENT-PLAN §1） */
export const LEVEL_LABEL: Record<PubRestaurant["recommendationLevel"], string> = {
  wubiChi: "务必吃",
  yingChiBang: "应吃榜",
  keyiChi: "可以吃",
  daiChi: "待吃",
};

/** 实吃档（本人实吃记录，用于「本人实吃」计数，排除待吃） */
export const EATEN_LEVELS = ["wubiChi", "yingChiBang", "keyiChi"] as const;
export const isEaten = (r: PubRestaurant) => r.recommendationLevel !== "daiChi";

/** 推荐榜单一律排除关店店（关店不进任何推荐块，只在地区页置灰置底） */
const open = (r: PubRestaurant) => !r.closed;
export const recentEats = restaurants.filter((r) => r.inRecent && open(r));
export const mustEats = restaurants.filter((r) => r.recommendationLevel === "wubiChi" && open(r));
export const topList = restaurants.filter((r) => r.recommendationLevel === "yingChiBang" && open(r));
export const waitList = restaurants.filter((r) => r.recommendationLevel === "daiChi" && open(r));

/** 展示日期：月精度展示 YYYY.MM，不伪造具体日 */
export function fmtVisited(r: PubRestaurant): string | null {
  if (!r.visitedAt) return null;
  if (r.visitedAtPrecision === "month") {
    const [y, m] = r.visitedAt.split("-");
    return `${y}.${m}`;
  }
  return r.visitedAt.replaceAll("-", ".");
}

/** 评分展示：x.x/10；无分不显示（缺评分不显示分数） */
export function fmtScore(score: number | null): string | null {
  if (score === null) return null;
  return `${Number.isInteger(score) ? score.toFixed(0) : score.toFixed(1)}/10`;
}

/** 导航外链按地区分供应商：国内→高德，海外(日本/新加坡/泰国)→Google 地图（用户 2026-09-16） */
const OVERSEAS = new Set(["japan", "singapore", "thailand"]);
export const isOverseas = (r: PubRestaurant) => OVERSEAS.has(r.regionSlug);
export const navUrl = (r: PubRestaurant) =>
  isOverseas(r)
    ? `https://www.google.com/maps/search/?api=1&query=${r.amapQuery}`
    : `https://uri.amap.com/search?keyword=${r.amapQuery}`;
export const navProvider = (r: PubRestaurant) => (isOverseas(r) ? "Google 地图" : "高德地图");
/** 多门店：单个门店的导航链接（供应商跟随所属地区） */
export const branchNavUrl = (r: PubRestaurant, b: PubBranch) =>
  isOverseas(r)
    ? `https://www.google.com/maps/search/?api=1&query=${b.amapQuery}`
    : `https://uri.amap.com/search?keyword=${b.amapQuery}`;
/** 人均展示：¥N/人；无则 null */
export const fmtPrice = (r: PubRestaurant) => (r.avgPrice ? `¥${Math.round(r.avgPrice)}/人` : null);
/** @deprecated 用 navUrl；保留别名避免遗漏引用 */
export const amapUrl = navUrl;

/** 最后更新：可见内容实质变化（当前取发布集最大 contentUpdatedAt） */
export function lastUpdated(list = restaurants): string | null {
  const max = list.map((r) => r.contentUpdatedAt).sort().pop();
  return max ? max.replaceAll("-", ".") : null;
}

// base 感知的目录式路由（部署在 /dachitech/ 子路径；BASE_URL 由 astro.config.base 注入，带尾斜杠）
const BASE = import.meta.env.BASE_URL;
export const homePath = BASE;
/** 图片路径加 base（数据里存不带 base 的相对路径） */
export const asset = (p: string) => `${BASE}${p}`;
export function detailPath(r: PubRestaurant) {
  return `${BASE}${r.regionSlug}/${encodeURIComponent(r.slug)}/`;
}
export function regionPath(slug: string) {
  return `${BASE}${slug}/`;
}
