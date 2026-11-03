import { Provider } from '@nestjs/common';
import { createDb, Db } from '@election/db';

export const DB = Symbol('DB');

export const dbProvider: Provider = {
  provide: DB,
  useFactory: async (): Promise<Db> => {
    const { db } = await createDb(process.env.DATABASE_URL);
    return db;
  },
};
