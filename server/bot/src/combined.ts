await Promise.all([
  import("./dashboard/server.js"),
  import("./live.js"),
]);
