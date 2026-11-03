import { Provider } from '@nestjs/common';
import { createDb, Db } from '@election/db';

export const DB = Symbol('DB');

/** Real deployment: reads DATABASE_URL (docker-compose/RDS Postgres). Test/dev
 * default: in-process PGlite via createDb() with no url. */
export const dbProvider: Provider = {
  provide: DB,
  useFactory: async (): Promise<Db> => {
    const { db } = await createDb(process.env.DATABASE_URL);
    return db;
  },
};
