import { getLocalD1 } from '../db/local-d1';

export const env = {
  get DB() { return getLocalD1(); },
};
