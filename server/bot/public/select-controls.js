(() => {
  // Lucide ChevronDown, ArrowLeft and Check (ISC license).
  const icon = (path, name = "") => `<svg class="control-icon ${name}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const chevron = icon('<path d="m6 9 6 6 6-6"/>', "control-chevron");
  const check = icon('<path d="m20 6-11 11-5-5"/>');
  const back = icon('<path d="m12 19-7-7 7-7"/><path d="M5 12h14"/>');
  const controls = [];
  let opened = null;

  function enhance(select, index) {
    const wrapper = document.createElement("div");
    wrapper.className = "select-control";
    select.before(wrapper);
    wrapper.append(select);
    select.hidden = true;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "select-trigger";
    trigger.id = `select-trigger-${index}`;
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", `select-menu-${index}`);
    const label = [...(select.labels?.[0]?.childNodes ?? [])].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join("").trim();
    trigger.setAttribute("aria-label", select.getAttribute("aria-label") || label || "არჩევა");
    const value = document.createElement("span");
    value.className = "select-value";
    trigger.append(value);
    trigger.insertAdjacentHTML("beforeend", chevron);
    const menu = document.createElement("div");
    menu.id = `select-menu-${index}`;
    menu.className = "select-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-labelledby", trigger.id);
    menu.hidden = true;
    if (typeof menu.showPopover === "function") menu.setAttribute("popover", "manual");
    wrapper.append(trigger, menu);
    let active = -1;
    let search = "";
    let searchAt = 0;

    const options = () => [...select.options].filter((option) => !option.hidden);
    function position() {
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const bottom = (viewport?.height ?? innerHeight) + (viewport?.offsetTop ?? 0);
      if (rect.bottom < 0 || rect.top > bottom) { close(); return; }
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 6}px`;
      menu.style.width = `${rect.width}px`;
      menu.style.maxHeight = `${Math.max(40, Math.min(280, bottom - rect.bottom - 14))}px`;
    }
    function highlight(next) {
      const items = options();
      if (!items.length) return;
      active = next;
      [...menu.children].forEach((item, i) => item.classList.toggle("highlighted", i === active));
      const selected = menu.children[active];
      if (selected) {
        trigger.setAttribute("aria-activedescendant", selected.id);
        selected.scrollIntoView({ block: "nearest" });
      }
    }
    function close(focus = false) {
      if (opened !== control) return;
      if (menu.hasAttribute("popover") && menu.matches(":popover-open")) menu.hidePopover();
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      opened = null;
      if (focus) trigger.focus({ preventScroll: true });
    }
    function sync() {
      const selected = select.selectedOptions[0];
      const text = selected?.label ?? "არჩევა";
      if (value.textContent !== text) value.textContent = text;
      trigger.disabled = select.disabled || !select.options.length;
      if (trigger.disabled) close();
    }
    function choose(option) {
      if (option.disabled) return;
      select.value = option.value;
      sync();
      close(true);
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function open() {
      if (trigger.disabled) return;
      opened?.close();
      const rect = trigger.getBoundingClientRect();
      if (innerHeight - rect.bottom < Math.min(160, options().length * 42 + 16)) {
        trigger.scrollIntoView({ block: "center", behavior: "instant" });
      }
      menu.replaceChildren(...options().map((option, i) => {
        const row = document.createElement("div");
        row.id = `select-option-${index}-${i}`;
        row.className = "select-option";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(option.selected));
        row.setAttribute("aria-disabled", String(option.disabled));
        const text = document.createElement("span");
        text.textContent = option.label;
        row.append(text);
        if (option.selected) row.insertAdjacentHTML("beforeend", check);
        row.addEventListener("pointerdown", (event) => event.preventDefault());
        row.addEventListener("click", () => choose(option));
        return row;
      }));
      opened = control;
      menu.hidden = false;
      if (menu.hasAttribute("popover")) menu.showPopover();
      trigger.setAttribute("aria-expanded", "true");
      position();
      active = options().findIndex((option) => option.selected && !option.disabled);
      highlight(active < 0 ? options().findIndex((option) => !option.disabled) : active);
    }
    const control = { sync, close, position, wrapper, trigger };
    trigger.addEventListener("click", () => opened === control ? close() : open());
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); return; }
      if (event.key === "Tab") { close(); return; }
      if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        if (opened !== control) { open(); return; }
        const items = options();
        if (event.key === "Enter" || event.key === " ") { if (items[active]) choose(items[active]); return; }
        const enabled = items.map((option, i) => option.disabled ? -1 : i).filter((i) => i >= 0);
        const current = enabled.indexOf(active);
        const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1)
          : enabled[(current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length];
        if (next !== undefined) highlight(next);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        if (opened !== control) open();
        search = Date.now() - searchAt < 600 ? search + event.key : event.key;
        searchAt = Date.now();
        const next = options().findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(search.toLocaleLowerCase()));
        if (next >= 0) highlight(next);
      }
    });
    select.addEventListener("change", sync);
    new MutationObserver(() => { close(); sync(); }).observe(select, { childList: true, subtree: true, attributes: true });
    select.form?.addEventListener("reset", () => setTimeout(sync, 0));
    select.labels?.[0]?.addEventListener("click", (event) => {
      if (event.target === select.labels[0]) { event.preventDefault(); trigger.focus(); }
    });
    sync();
    controls.push(control);
  }

  document.querySelectorAll("select").forEach(enhance);
  document.querySelectorAll(".back-button").forEach((button) => {
    const label = document.createElement("span");
    label.textContent = button.textContent.replace(/^←\s*/, "");
    button.replaceChildren();
    button.insertAdjacentHTML("beforeend", back);
    button.append(label);
  });
  document.querySelectorAll("summary > i").forEach((item) => { item.innerHTML = chevron; });
  window.refreshSelectControls = () => controls.forEach((control) => control.sync());
  ["click", "input", "change"].forEach((event) => document.addEventListener(event, () => queueMicrotask(window.refreshSelectControls)));
  document.addEventListener("pointerdown", (event) => { if (opened && !opened.wrapper.contains(event.target)) opened.close(); });
  document.addEventListener("scroll", () => { if (opened && !opened.wrapper.querySelector(".select-menu")?.contains(document.activeElement)) opened.position(); }, true);
  window.addEventListener("resize", () => opened?.position());
  window.visualViewport?.addEventListener("resize", () => opened?.position());
  window.addEventListener("popstate", () => opened?.close());
  document.addEventListener("close", () => opened?.close(), true);
})();
