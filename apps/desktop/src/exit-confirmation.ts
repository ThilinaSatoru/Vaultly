export function createExitGuard(hasTasks: () => Promise<boolean>, confirm: () => Promise<boolean>) {
  let approved = false;
  let checking = false;
  return {
    get approved() { return approved; },
    async request(exit: () => void) {
      if (checking || approved) return;
      checking = true;
      try {
        if (await hasTasks() && !await confirm()) return;
        approved = true;
        exit();
      } finally { checking = false; }
    },
  };
}
