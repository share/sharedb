const doNothing = () => void 0;

const hasKeys = (object:any) => {
  for (const key in object) return true;
  return false;
};

export {doNothing, hasKeys};
