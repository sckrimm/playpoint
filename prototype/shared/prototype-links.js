(function () {
  const routes = {
    splash: "../splash/index.html",
    phone: "../phone-login/index.html",
    otp: "../otp-verification/index.html",
    setup: "../profile-setup/index.html",
    home: "../home/index.html",
    loading: "../game-loading/index.html",
    game: "../game-frame/index.html",
    score: "../score-popup/index.html",
    daily: "../leaderboard-daily/index.html",
    weekly: "../leaderboard-weekly/index.html",
    rewards: "../rewards/index.html",
    profile: "../profile/index.html",
    editProfile: "../edit-profile/index.html"
  };

  const path = window.location.pathname;
  const folder = (path.match(/\/screens\/([^/]+)\/index\.html$/) || [])[1] || "";

  function go(route) {
    window.location.href = routes[route];
  }

  function textOf(node) {
    return (node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function iconOf(node) {
    const icon = node.querySelector(".material-symbols-outlined");
    return icon ? textOf(icon) : "";
  }

  function wireNavLink(anchor) {
    const text = textOf(anchor);
    const icon = iconOf(anchor);

    if (icon === "home" || text.includes("home")) anchor.href = routes.home;
    if (icon === "leaderboard" || text.includes("rank") || text.includes("ლიდერბორდ")) anchor.href = routes.daily;
    if (icon === "redeem" || text.includes("reward") || text.includes("პრიზ")) anchor.href = routes.rewards;
    if (icon === "person" || text.includes("me") || text.includes("პროფილ")) anchor.href = routes.profile;
  }

  document.querySelectorAll("a[href='#']").forEach(wireNavLink);

  document.querySelectorAll("button").forEach((button) => {
    const text = textOf(button);
    const icon = iconOf(button);

    if (text.includes("გაგრძელება")) button.addEventListener("click", () => go("otp"));
    if (text.includes("დადასტურება")) button.addEventListener("click", () => go("setup"));
    if (text.includes("play") || icon === "sports_esports") button.addEventListener("click", () => go("loading"));
    if (text.includes("ნახე სრული სია") || text.includes("ყველა")) button.addEventListener("click", () => go("daily"));
    if (text.includes("ranks") || icon === "workspace_premium") button.addEventListener("click", () => go("daily"));
    if (text.includes("home") || icon === "home") button.addEventListener("click", () => go("home"));
    if (text.includes("play again") || icon === "replay") button.addEventListener("click", () => go("loading"));
  });

  if (folder === "splash") {
    document.body.addEventListener("click", () => {
      setTimeout(() => go("phone"), 650);
    });
  }

  if (folder === "profile-setup") {
    window.finishSetup = function () {
      const nameInput = document.getElementById("name-input");
      const modal = document.getElementById("success-modal");
      const content = document.getElementById("modal-content");
      const progress = document.getElementById("progress-bar");

      if (modal && content && progress) {
        modal.classList.remove("hidden");
        setTimeout(() => {
          content.classList.remove("scale-90", "opacity-0");
          content.classList.add("scale-100", "opacity-100");
          progress.style.transition = "width 1.2s ease-in-out";
          progress.style.width = "100%";
        }, 10);
      }

      localStorage.setItem("playpointUserName", (nameInput && nameInput.value) || "მომხმარებელი");
      setTimeout(() => go("home"), 1400);
    };
  }

  if (folder === "game-loading") {
    setTimeout(() => go("game"), 2400);
  }

  if (folder === "game-frame") {
    setTimeout(() => go("score"), 5000);
  }

  if (folder === "leaderboard-daily") {
    const weekly = document.getElementById("tab-weekly");
    if (weekly) weekly.addEventListener("click", () => go("weekly"));
  }

  if (folder === "leaderboard-weekly") {
    const firstButton = document.querySelector("button");
    if (firstButton && textOf(firstButton).includes("დღიური")) {
      firstButton.addEventListener("click", () => go("daily"));
    }
  }

  if (folder === "profile") {
    const settings = document.querySelector("header button");
    if (settings) settings.addEventListener("click", () => go("editProfile"));
  }
})();
