/**
 * 灯箱（DEVELOPMENT-PLAN §7：点图放大；用成熟组件，不自造手势引擎 → PhotoSwipe 5）。
 * 约定：容器带 data-gallery（JSON：src 高清 1600 / msrc 缩略 400 / width / height / alt），
 *       容器内可点元素带 data-shot="序号"。卡片和详情页共用。
 * 支持：手机左右滑切图、双指/双击放大、Esc 关闭、← → 切换、焦点圈定，关闭后焦点回到原按钮。
 */
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";

document.addEventListener("click", (e) => {
  const shot = (e.target as HTMLElement).closest<HTMLElement>("[data-shot]");
  const box = shot?.closest<HTMLElement>("[data-gallery]");
  if (!shot || !box) return;
  e.preventDefault();
  e.stopPropagation(); // 不触发卡片的「定位到地图」
  let items: any[] = [];
  try { items = JSON.parse(box.dataset.gallery || "[]"); } catch { return; }
  if (!items.length) return;
  const pswp = new PhotoSwipe({
    dataSource: items,
    index: Number(shot.dataset.shot) || 0,
    bgOpacity: 0.92,
    showHideAnimationType: "fade",
    wheelToZoom: true,
    closeTitle: "关闭",
    zoomTitle: "放大",
    arrowPrevTitle: "上一张",
    arrowNextTitle: "下一张",
    errorMsg: "这张图没加载出来",
    indexIndicatorSep: " / ",
  });
  pswp.init();
});
