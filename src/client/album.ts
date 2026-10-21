/** A 版滑动相册：同步「1 / N」计数与 ‹ › 显隐；箭头翻页。手势滑动交给原生 scroll-snap。 */
document.querySelectorAll<HTMLElement>("[data-album]").forEach((box) => {
  const track = box.querySelector<HTMLElement>(".rc-track");
  const label = box.querySelector<HTMLElement>("[data-album-i]");
  const prev = box.querySelector<HTMLButtonElement>(".rc-arrow--prev");
  const next = box.querySelector<HTMLButtonElement>(".rc-arrow--next");
  if (!track || !label) return;
  const n = track.children.length;
  const cur = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const sync = () => {
    const i = cur();
    label.textContent = String(i + 1);
    if (prev) prev.hidden = i === 0;
    if (next) next.hidden = i >= n - 1;
  };
  track.addEventListener("scroll", () => requestAnimationFrame(sync), { passive: true });
  box.querySelectorAll<HTMLButtonElement>("[data-album-step]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      track.scrollTo({ left: (cur() + Number(b.dataset.albumStep)) * track.clientWidth, behavior: "smooth" });
    }));
  // 灯箱关闭后回到当前看的那张：灯箱按 data-shot 开，与相册位置天然一致
});
