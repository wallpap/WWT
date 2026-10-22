export function initializeQuickNavigation(): void {
  const dialog = document.querySelector<HTMLDialogElement>("#quick-nav-dialog")!;
  const trigger = document.querySelector<HTMLButtonElement>("#quick-nav-open")!;
  const input = document.querySelector<HTMLInputElement>("#quick-nav-input")!;
  const results = document.querySelector<HTMLElement>("#quick-nav-results")!;
  const empty = document.querySelector<HTMLElement>("#quick-nav-empty")!;
  const pages = [...document.querySelectorAll<HTMLButtonElement>(".nav-item[data-page-target]")].map((button) => ({
    button,
    label: button.querySelector(".nav-text")!.textContent!.trim(),
    group: button.closest(".nav-group")!.querySelector(".nav-label")!.textContent!.trim(),
  }));
  let selectedIndex = 0;
  let matches = pages;
  let options: HTMLButtonElement[] = [];

  const select = (index: number): void => {
    selectedIndex = index;
    options.forEach((option, current) => option.setAttribute("aria-selected", String(current === index)));
    const selected = options[index];
    if (selected) {
      input.setAttribute("aria-activedescendant", selected.id);
      selected.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };

  const navigate = (index: number): void => {
    const page = matches[index];
    if (!page) return;
    dialog.close();
    page.button.click();
    document.querySelector<HTMLElement>("#page-label")!.focus({ preventScroll: true });
  };

  const render = (): void => {
    const term = input.value.trim().toLocaleLowerCase();
    matches = pages.filter((page) => `${page.label} ${page.group} ${page.button.dataset["pageTarget"]}`.toLocaleLowerCase().includes(term));
    options = matches.map((page, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `quick-nav-option-${index}`;
      option.className = "quick-nav-option";
      option.setAttribute("role", "option");
      option.tabIndex = -1;
      const icon = page.button.querySelector("svg")!.cloneNode(true);
      const label = document.createElement("span");
      label.textContent = page.label;
      const group = document.createElement("small");
      group.textContent = page.group;
      option.append(icon, label, group);
      option.addEventListener("click", () => navigate(index));
      return option;
    });
    results.replaceChildren(...options);
    empty.hidden = matches.length > 0;
    select(0);
  };

  const open = (): void => {
    if (dialog.open) return;
    input.value = "";
    dialog.showModal();
    render();
    input.focus();
  };
  trigger.addEventListener("click", open);
  document.querySelector("#quick-nav-close")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    // 点击对话框外的遮罩关闭，内部留白仍保持可交互。
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  input.addEventListener("input", render);
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      navigate(selectedIndex);
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length) {
      event.preventDefault();
      select((selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    }
  });
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !event.isComposing) {
      event.preventDefault();
      if (dialog.open) dialog.close();
      else open();
    }
  });
}
