module.exports = async function stopSmokeProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  await new Promise((resolveExit, rejectExit) => {
    child.once("close", resolveExit);
    child.once("error", rejectExit);
    child.kill("SIGKILL");
  });
};
