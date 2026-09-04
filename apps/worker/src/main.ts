// Queue consumers are added after the synchronous voice path is proven.
// Keeping a deployable worker process now preserves the runtime boundary from the PRD.
console.info(JSON.stringify({
  service: "worker",
  status: "ready",
  message: "No job processors registered yet",
}));
