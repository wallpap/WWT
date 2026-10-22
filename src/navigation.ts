export function initializeNavigation(): void {
  const main = document.querySelector("main");
  const sections = document.querySelectorAll<HTMLElement>("[data-page]");
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-page-target]");
  const navItems = document.querySelectorAll<HTMLButtonElement>(".nav-item[data-page-target]");
  const pageLabel = document.querySelector<HTMLElement>("#page-label");

  const labelFor = (page: string): string => {
    for (const item of navItems) {
      if (item.dataset["pageTarget"] !== page) continue;
      return item.querySelector<HTMLElement>(".nav-text")?.textContent?.trim() || page;
    }
    return page;
  };

  const syncLabel = (page: string): void => {
    const label = labelFor(page);
    if (pageLabel && pageLabel.textContent !== label) pageLabel.textContent = label;
    const title = `鸣潮助手 · ${label}`;
    if (document.title !== title) document.title = title;
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const page = button.dataset["pageTarget"];
      if (!page) return;
      for (const section of sections) section.hidden = section.dataset["page"] !== page;
      for (const item of navItems) {
        const active = item.dataset["pageTarget"] === page;
        item.classList.toggle("active", active);
        if (active) {
          item.setAttribute("aria-current", "page");
          item.scrollIntoView({
            block: "nearest",
            inline: "nearest",
            behavior: "instant",
          });
        } else item.removeAttribute("aria-current");
      }
      syncLabel(page);
      main?.scrollTo({ top: 0, left: 0, behavior: "instant" });
      window.dispatchEvent(new CustomEvent("page-changed", { detail: page }));
    });
  }

  const initial = document.querySelector<HTMLButtonElement>(".nav-item.active[data-page-target]")?.dataset["pageTarget"] ?? "launcher";
  syncLabel(initial);
}
