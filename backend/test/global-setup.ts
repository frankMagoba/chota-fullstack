import pg from 'pg';

export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://chota:chota@localhost:5432/chota_test');
  const dbName = url.pathname.slice(1);
  const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const { migrate } = await import('../scripts/migrate.js');
  await migrate(url.toString());
}
