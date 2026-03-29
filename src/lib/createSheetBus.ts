export type OpenCreateSheetListener = () => void;

const listeners = new Set<OpenCreateSheetListener>();

export const subscribeOpenCreateSheet = (listener: OpenCreateSheetListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const requestOpenCreateSheet = () => {
  if (listeners.size === 0) return false;

  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error("requestOpenCreateSheet: listener failed", error);
    }
  });

  return true;
};
